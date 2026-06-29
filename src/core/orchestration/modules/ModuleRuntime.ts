import { PagNode } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkParameterRef } from "../../../../arkanalyzer/out/src/core/base/Ref";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import {
    ModuleAnalysisApi,
    emptyModuleAuditSnapshot,
    ModuleAuditEntry,
    ModuleAuditSnapshot,
    ModuleBridgeApi,
    ModuleCallbackApi,
    ModuleCallbackResolveOptions,
    ModuleCopyEdgeEvent,
    ModuleCurrentFactView,
    ModuleCurrentNodeView,
    ModuleDeclarativeDeferredBindingDeclaration,
    ModuleDeferredBindingApi,
    ModuleDebugApi,
    ModuleEmission,
    ModuleEmissionAuditEntry,
    ModuleEmitCollector,
    ModuleEmitApi,
    ModuleEmitOptions,
    ModuleFactEvent,
    ModuleInvokeEvent,
    ModuleInvokeMatchApi,
    ModuleConstructScanFilter,
    ModuleInvokeScanFilter,
    ModuleAssignScanFilter,
    ModuleScannedAssign,
    ModuleParameterBindingScanFilter,
    ModuleScannedParameterBinding,
    ModuleFieldLoadScanFilter,
    ModuleScannedFieldLoad,
    ModuleFieldStoreScanFilter,
    ModuleScannedFieldStore,
    ModuleDecoratedFieldScanFilter,
    ModuleScannedDecoratedField,
    ModuleScannedDecorator,
    ModuleScannedInvoke,
    ModuleCanonicalApiOccurrence,
    ModuleCanonicalDecoratorOccurrence,
    ModuleMethodsApi,
    ModuleRuntime,
    ModuleResolvedCallbackMethod,
    ModuleResolvedCallbackParamBinding,
    ModuleSession,
    ModuleSetupContext,
    ModuleSetupCallbackApi,
    ModuleScanApi,
    ModuleKeyedNodeRelay,
    ModuleNodeRelay,
    ModuleFieldRelay,
    RawModuleSetupContext,
    TaintModule,
    ModuleValueEmitOptions,
} from "../../kernel/contracts/ModuleContract";
import type {
    InternalModuleQueryApi,
    InternalRawModuleCopyEdgeEvent,
    InternalRawModuleFactEvent,
    InternalRawModuleInvokeEvent,
    InternalRawModuleSetupContext,
} from "../../kernel/contracts/ModuleInternal";
import { collectNodeIdsFromValue, collectObjectNodeIdsFromValue } from "../../kernel/contracts/HarmonyModuleUtils";
import { getMethodBySignature } from "../../kernel/contracts/MethodLookup";
import { resolveCallbackMethodsFromValueWithReturns } from "../../substrate/queries/CallbackBindingQuery";
import type {
    ModuleExplicitDeclarativeDeferredBindingRecord,
    ModuleExplicitDeferredBindingRecord,
    ModuleExplicitImperativeDeferredBindingRecord,
} from "../../kernel/model/DeferredBindingDeclaration";
import { TaintFact } from "../../kernel/model/TaintFact";
import { collectCarrierNodeIdsForValueAtStmt } from "../../kernel/ordinary/OrdinaryAliasPropagation";
import {
    isConsumableSemanticEndpointProjection,
    materializeExactPagNodes,
    projectSemanticEffectEndpoint,
} from "../../kernel/contracts/PagNodeResolution";
import {
    extractErrorLocation,
    getExtensionSourceModulePath,
    preferExtensionSourceLocation,
} from "../ExtensionLoaderUtils";

interface RegisteredSession {
    moduleId: string;
    session: ModuleSession;
    sourcePath?: string;
    runtimeContext: ModuleSetupContext;
}

interface DeferredBindingCollector {
    add(binding: ModuleExplicitDeferredBindingRecord): void;
    all(): ModuleExplicitDeferredBindingRecord[];
}

class ModuleRuntimeDiagnosticError extends Error {
    readonly diagnosticCode: string;
    readonly diagnosticAdvice: string;

    constructor(message: string, diagnosticCode: string, diagnosticAdvice: string) {
        super(message);
        this.name = "ModuleRuntimeDiagnosticError";
        this.diagnosticCode = diagnosticCode;
        this.diagnosticAdvice = diagnosticAdvice;
    }
}

function normalizePhaseCode(value: string): string {
    return value
        .replace(/[^A-Za-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .toUpperCase();
}

function classifyModuleFailure(
    hook: string,
    error: unknown,
): { code: string; advice: string } {
    if (error instanceof ModuleRuntimeDiagnosticError) {
        return {
            code: error.diagnosticCode,
            advice: error.diagnosticAdvice,
        };
    }
    const phaseCode = normalizePhaseCode(hook);
    return {
        code: `MODULE_${phaseCode}_THROW`,
        advice: "This module threw directly from one of its runtime hooks. Check nearby code, null handling, and helper return values.",
    };
}

function cloneFieldPath(field?: string[]): string[] | undefined {
    return field && field.length > 0 ? [...field] : undefined;
}

function resolveTargetNode(
    event: InternalRawModuleFactEvent,
    target: number | PagNode | null | undefined,
): PagNode | undefined {
    if (target === undefined || target === null) return undefined;
    if (typeof target === "number") {
        if (event.node.getID() === target) {
            return event.node;
        }
        return event.pag.getNode(target) as PagNode | undefined;
    }
    return target as PagNode;
}

type EmitFieldMode = "generic" | "preserve_current" | "current_field_tail" | "explicit";

function resolveEmitFieldPath(
    event: InternalRawModuleFactEvent,
    mode: EmitFieldMode,
    explicitField?: string[],
): string[] | undefined {
    if (mode === "generic") {
        return undefined;
    }
    if (mode === "preserve_current") {
        return cloneFieldPath(event.fact.field);
    }
    if (mode === "current_field_tail") {
        return event.fact.field && event.fact.field.length > 1
            ? [...event.fact.field.slice(1)]
            : undefined;
    }
    return cloneFieldPath(explicitField);
}

function appendRecentDebugMessage(entry: ModuleAuditEntry, kind: "HIT" | "SKIP" | "LOG", message: string): void {
    entry.recentDebugMessages.push(`${kind}: ${message}`);
    if (entry.recentDebugMessages.length > 8) {
        entry.recentDebugMessages.splice(0, entry.recentDebugMessages.length - 8);
    }
}

function formatSummaryParts(
    metrics: Record<string, unknown>,
    omitEmpty: boolean,
): string[] {
    return Object.entries(metrics)
        .filter(([, value]) => {
            if (!omitEmpty) return true;
            if (value === undefined || value === null) return false;
            if (typeof value === "number") return value !== 0;
            if (typeof value === "string") return value.length > 0;
            if (typeof value === "boolean") return value;
            if (Array.isArray(value)) return value.length > 0;
            if (value instanceof Set || value instanceof Map) return value.size > 0;
            return true;
        })
        .map(([key, value]) => `${key}=${String(value)}`);
}

function buildDebugApi(moduleId: string, entry: ModuleAuditEntry, log: (msg: string) => void): ModuleDebugApi {
    const emit = (kind: "HIT" | "SKIP" | "LOG", message: string): void => {
        if (kind === "HIT") {
            entry.debugHitCount += 1;
        } else if (kind === "SKIP") {
            entry.debugSkipCount += 1;
        } else {
            entry.debugLogCount += 1;
        }
        appendRecentDebugMessage(entry, kind, message);
        log(`[Module:${moduleId}] ${kind} ${message}`);
    };
    return {
        hit(message: string): void {
            emit("HIT", message);
        },
        skip(message: string): void {
            emit("SKIP", message);
        },
        log(message: string): void {
            emit("LOG", message);
        },
        summary(label, metrics, options = {}) {
            if (options.enabled === false) return;
            const parts = formatSummaryParts(metrics, options.omitEmpty !== false);
            if (parts.length === 0) return;
            emit("LOG", `[${label}] ${parts.join(", ")}`);
        },
    };
}

function buildSetupDebugApi(
    log: (msg: string) => void,
    entry?: ModuleAuditEntry,
): ModuleSetupContext["debug"] {
    return {
        summary(label, metrics, options = {}) {
            if (options.enabled === false) return;
            const parts = formatSummaryParts(metrics, options.omitEmpty !== false);
            if (parts.length === 0) return;
            const message = `[${label}] ${parts.join(", ")}`;
            if (entry) {
                entry.debugLogCount += 1;
                appendRecentDebugMessage(entry, "LOG", message);
            }
            log(message);
        },
    };
}

function createDeferredBindingCollector(): DeferredBindingCollector {
    const bindings: ModuleExplicitDeferredBindingRecord[] = [];
    const seen = new Set<string>();
    return {
        add(binding: ModuleExplicitDeferredBindingRecord): void {
            const key = [
                binding.moduleId,
                binding.bindingKind,
                binding.sourceMethod?.getSignature?.()?.toString?.() || "",
                binding.unit?.getSignature?.()?.toString?.() || "",
                binding.anchorStmt?.getOriginPositionInfo?.()?.getLineNo?.() || 0,
                binding.reason,
            ].join("|");
            if (seen.has(key)) return;
            seen.add(key);
            bindings.push(binding);
        },
        all(): ModuleExplicitDeferredBindingRecord[] {
            return [...bindings];
        },
    };
}

function assertModuleSetupBudget(
    raw: InternalRawModuleSetupContext,
    phase: string,
): void {
    const budgetMs = raw.moduleSetupDeadlineMs;
    const startedAtMs = raw.moduleSetupStartedAtMs;
    if (!budgetMs || budgetMs <= 0 || !startedAtMs) return;
    const elapsedMs = Date.now() - startedAtMs;
    if (elapsedMs <= budgetMs) return;
    const moduleId = raw.moduleSetupModuleId || "<unknown-module>";
    throw new ModuleRuntimeDiagnosticError(
        `module ${moduleId} setup exceeded ${budgetMs}ms during ${phase} (elapsed=${elapsedMs}ms)`,
        "MODULE_SETUP_BUDGET_EXCEEDED",
        "The module exceeded its setup scan budget and was disabled for this run. Use a narrower asset selector or raise --moduleSetupBudgetMs for stress validation.",
    );
}

function createAnalysisApi(raw: InternalRawModuleSetupContext): ModuleAnalysisApi {
    let classBySignature: Map<string, any> | undefined;
    const getClassBySignature = (): Map<string, any> => {
        if (classBySignature) return classBySignature;
        classBySignature = new Map<string, any>();
        for (const cls of raw.scene.getClasses()) {
            const sig = cls.getSignature?.().toString?.() || "";
            if (sig) classBySignature.set(sig, cls);
        }
        return classBySignature;
    };
    const nodeIdsForValue = (value: any, anchorStmt?: any): number[] => {
        if (!raw.pag) return [];
        const direct = collectNodeIdsFromValue(raw.pag, value);
        if (direct.size > 0 || !anchorStmt || !shouldMaterializeExactModuleUseEndpoint(value)) {
            return [...direct.values()];
        }
        return [...(materializeExactPagNodes(raw.pag, value, anchorStmt, 0)?.values() || [])];
    };
    const exactEndpointNodeIdsForValue = (value: any, anchorStmt?: any): number[] => {
        if (!raw.pag) return [];
        const direct = collectNodeIdsFromValue(raw.pag, value);
        if (direct.size > 0 || !anchorStmt || !shouldMaterializeExactModuleEndpointValue(value)) {
            return [...direct.values()];
        }
        return [...(materializeExactPagNodes(raw.pag, value, anchorStmt, 0)?.values() || [])];
    };
    const resultNodeIdsForValue = (value: any, anchorStmt?: any): number[] => {
        if (!raw.pag) return [];
        const direct = collectNodeIdsFromValue(raw.pag, value);
        if (direct.size > 0 || !anchorStmt || !shouldMaterializeExactModuleResultEndpoint(value)) {
            return [...direct.values()];
        }
        return [...(materializeExactPagNodes(raw.pag, value, anchorStmt, 0)?.values() || [])];
    };
    const objectNodeIdsForValue = (value: any): number[] => {
        if (!raw.pag) return [];
        return [...collectObjectNodeIdsFromValue(raw.pag, value).values()];
    };
    return {
        nodeIdsForValue,
        exactEndpointNodeIdsForValue,
        resultNodeIdsForValue,
        objectNodeIdsForValue,
        carrierNodeIdsForValue(value: any, anchorStmt?: any): number[] {
            const carrierResolved = raw.pag && value && anchorStmt
                ? collectCarrierNodeIdsForValueAtStmt(raw.pag, value, anchorStmt, getClassBySignature())
                : [];
            return [...new Set<number>([
                ...nodeIdsForValue(value, anchorStmt),
                ...objectNodeIdsForValue(value),
                ...carrierResolved,
            ])];
        },
        resultCarrierNodeIdsForValue(value: any, anchorStmt?: any): number[] {
            const carrierResolved = raw.pag && value && anchorStmt
                ? collectCarrierNodeIdsForValueAtStmt(raw.pag, value, anchorStmt, getClassBySignature())
                : [];
            return [...new Set<number>([
                ...resultNodeIdsForValue(value, anchorStmt),
                ...objectNodeIdsForValue(value),
                ...carrierResolved,
            ])];
        },
        aliasLocalsForCarrier(carrierNodeId: number): any[] {
            if (!raw.pag) return [];
            const mod = require("../../kernel/contracts/ModuleCarrierResolution") as typeof import("../../kernel/contracts/ModuleCarrierResolution");
            return mod.collectAliasLocalsForCarrier(raw.pag, carrierNodeId);
        },
        stringCandidates(value: any, maxDepth?: number): string[] {
            if (!raw.scene) return [];
            return raw.queries.collectFiniteStringCandidatesFromValue(raw.scene, value, maxDepth);
        },
        projectEndpoint(input) {
            return projectSemanticEffectEndpoint({
                ...input,
                pag: raw.pag,
                resolveEndpointAccessPathNodeIds(values, accessPath) {
                    return resolveExactModuleAccessPathCarrierNodeIds(
                        raw.pag,
                        values,
                        accessPath,
                        input.stmt,
                        getClassBySignature(),
                    );
                },
            });
        },
    };
}

function collectConsumableSemanticEndpointNodeIds(input: {
    analysis: ModuleAnalysisApi;
    semanticEffectSites: readonly any[];
    stmt: any;
    invokeExpr: any;
    selector: { kind: string; index?: number; nodeKind?: string; rest?: boolean };
}): number[] {
    const out = new Set<number>();
    for (const semanticSite of input.semanticEffectSites || []) {
        if (!semanticEndpointMatchesSelector(semanticSite?.endpointSpec, input.selector)) {
            continue;
        }
        const projection = input.analysis.projectEndpoint({
            semanticSite,
            endpointSpec: semanticSite.endpointSpec,
            stmt: input.stmt,
            invokeExpr: input.invokeExpr,
        });
        if (!isConsumableSemanticEndpointProjection(projection)) {
            continue;
        }
        for (const nodeId of projection.nodeIds || []) {
            out.add(nodeId);
        }
        for (const nodeId of projection.carrierNodeIds || []) {
            out.add(nodeId);
        }
    }
    return [...out.values()];
}

function semanticEndpointMatchesSelector(
    endpointSpec: any,
    selector: { kind: string; index?: number; rest?: boolean },
): boolean {
    const base = endpointSpec?.base;
    if (!base || typeof base !== "object") {
        return false;
    }
    switch (selector.kind) {
        case "arg":
            if (selector.rest === true) {
                return base.kind === "rest" && Number(base.startIndex) === Number(selector.index);
            }
            return base.kind === "arg" && Number(base.index) === Number(selector.index);
        case "base":
            return base.kind === "receiver";
        case "result":
            return base.kind === "return" || base.kind === "constructorResult";
        default:
            return false;
    }
}

function resolveExactModuleAccessPathCarrierNodeIds(
    pag: any,
    values: readonly any[],
    accessPath: readonly string[],
    anchorStmt: any,
    classBySignature: Map<string, any>,
): number[] {
    if (!pag || !anchorStmt || accessPath.length === 0) return [];
    const out = new Set<number>();
    for (const value of values) {
        if (!value || !structuredAccessPathExistsForValue(value, accessPath, anchorStmt, classBySignature, 0, new Set<string>())) {
            continue;
        }
        for (const nodeId of collectCarrierNodeIdsForValueAtStmt(pag, value, anchorStmt, classBySignature)) {
            out.add(nodeId);
        }
        if (shouldMaterializeExactModuleUseEndpoint(value)) {
            for (const nodeId of materializeExactPagNodes(pag, value, anchorStmt, 0)?.values() || []) {
                out.add(nodeId);
            }
        }
    }
    return [...out.values()];
}

function structuredAccessPathExistsForValue(
    value: any,
    accessPath: readonly string[],
    anchorStmt: any,
    classBySignature: Map<string, any>,
    depth: number,
    visiting: Set<string>,
): boolean {
    if (!value || accessPath.length === 0) return true;
    if (depth > 8) return false;
    const classSignature = classSignatureFromValue(value);
    if (classSignature) {
        return structuredAccessPathExistsForClass(classSignature, accessPath, classBySignature, depth + 1, visiting);
    }
    if (value instanceof Local) {
        const key = `${anchorStmt?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.() || ""}:${value.getName?.() || ""}:${accessPath.join(".")}`;
        if (visiting.has(key)) return false;
        visiting.add(key);
        const assigned = latestAssignedValueBefore(value, anchorStmt);
        const result = assigned
            ? structuredAccessPathExistsForValue(assigned, accessPath, anchorStmt, classBySignature, depth + 1, visiting)
            : false;
        visiting.delete(key);
        return result;
    }
    return false;
}

function structuredAccessPathExistsForClass(
    classSignature: string,
    accessPath: readonly string[],
    classBySignature: Map<string, any>,
    depth: number,
    visiting: Set<string>,
): boolean {
    if (accessPath.length === 0) return true;
    if (depth > 8) return false;
    const key = `${classSignature}:${accessPath.join(".")}`;
    if (visiting.has(key)) return false;
    visiting.add(key);
    const cls = classBySignature.get(classSignature);
    if (!cls) {
        visiting.delete(key);
        return false;
    }
    const field = (cls.getFields?.() || []).find((item: any) => {
        const fieldName = item?.getSignature?.()?.getFieldName?.() || item?.getName?.();
        return fieldName === accessPath[0];
    });
    if (!field) {
        visiting.delete(key);
        return false;
    }
    if (accessPath.length === 1) {
        visiting.delete(key);
        return true;
    }
    const fieldTypeSignature = classSignatureFromValue(field);
    const result = fieldTypeSignature
        ? structuredAccessPathExistsForClass(fieldTypeSignature, accessPath.slice(1), classBySignature, depth + 1, visiting)
        : false;
    visiting.delete(key);
    return result;
}

function classSignatureFromValue(value: any): string | undefined {
    const signature = value?.getType?.()?.getClassSignature?.()
        || value?.getClassSignature?.()
        || value?.getSignature?.()?.getType?.()?.getClassSignature?.();
    const text = String(signature?.toString?.() || "").trim();
    return text && !text.includes("%unk") && !text.includes("@unk") ? text : undefined;
}

function latestAssignedValueBefore(local: Local, anchorStmt: any): any | undefined {
    const cfg = anchorStmt?.getCfg?.() || local.getDeclaringStmt?.()?.getCfg?.();
    const stmts = cfg?.getStmts?.();
    if (!stmts) return undefined;
    let latest: any;
    for (const stmt of stmts) {
        if (stmt === anchorStmt) break;
        if (stmt?.constructor?.name !== "ArkAssignStmt") continue;
        if (!isSameLocalValue(stmt.getLeftOp?.(), local)) continue;
        latest = stmt;
    }
    return latest?.getRightOp?.();
}

function collectModuleResultEndpointNodeIds(
    analysis: ModuleAnalysisApi,
    resultValue: any,
    stmt: any,
): number[] {
    const out = new Set<number>();
    if (resultValue !== undefined) {
        for (const nodeId of analysis.resultNodeIdsForValue(resultValue, stmt)) {
            out.add(nodeId);
        }
    }
    if (out.size > 0) {
        return [...out.values()];
    }

    const left = stmt?.getLeftOp?.();
    if (left === undefined || left === resultValue) {
        return [];
    }
    for (const nodeId of analysis.resultNodeIdsForValue(left, stmt)) {
        out.add(nodeId);
    }
    return [...out.values()];
}

function collectModuleResultEndpointCarrierNodeIds(
    analysis: ModuleAnalysisApi,
    resultValue: any,
    stmt: any,
): number[] {
    const out = new Set<number>();
    if (resultValue !== undefined) {
        for (const nodeId of analysis.resultCarrierNodeIdsForValue(resultValue, stmt)) {
            out.add(nodeId);
        }
    }
    if (out.size > 0) {
        return [...out.values()];
    }

    const left = stmt?.getLeftOp?.();
    if (left === undefined || left === resultValue) {
        return [];
    }
    for (const nodeId of analysis.resultCarrierNodeIdsForValue(left, stmt)) {
        out.add(nodeId);
    }
    return [...out.values()];
}

function collectModulePromiseResultEndpointNodeIds(
    method: any,
    analysis: ModuleAnalysisApi,
    resultValue: any,
    stmt: any,
): number[] {
    const resultLocal = resolveResultEndpointLocal(resultValue, stmt);
    if (!resultLocal) {
        return collectModuleResultEndpointNodeIds(analysis, resultValue, stmt);
    }

    const out = new Set<number>();
    const stmts = method?.getCfg?.()?.getStmts?.() || [];
    let afterInvokeStmt = false;
    for (const candidateStmt of stmts) {
        if (candidateStmt === stmt) {
            afterInvokeStmt = true;
            continue;
        }
        if (!afterInvokeStmt) continue;
        if (!isAssignStmtLike(candidateStmt)) continue;
        const right = candidateStmt.getRightOp?.();
        if (!isAwaitDerivedFromLocal(right, resultLocal)) continue;
        const left = candidateStmt.getLeftOp?.();
        if (!left) continue;
        for (const nodeId of analysis.resultNodeIdsForValue(left, candidateStmt)) {
            out.add(nodeId);
        }
    }

    if (out.size > 0) {
        return [...out.values()];
    }
    return collectModuleResultEndpointNodeIds(analysis, resultValue, stmt);
}

function resolveResultEndpointLocal(resultValue: any, stmt: any): any | undefined {
    const localName = resolveLocalName(resultValue);
    if (localName) return resultValue;
    const left = stmt?.getLeftOp?.();
    return resolveLocalName(left) ? left : undefined;
}

function isAwaitDerivedFromLocal(value: any, local: any, visiting: Set<any> = new Set()): boolean {
    if (!value || visiting.has(value)) return false;
    visiting.add(value);

    if (value.constructor?.name === "ArkAwaitExpr") {
        return expressionUsesLocal(value.getPromise?.(), local, visiting);
    }

    if (typeof value.getOp === "function" && isAwaitDerivedFromLocal(value.getOp(), local, visiting)) {
        return true;
    }

    for (const use of value.getUses?.() || []) {
        if (isAwaitDerivedFromLocal(use, local, visiting)) {
            return true;
        }
    }
    return false;
}

function expressionUsesLocal(value: any, local: any, visiting: Set<any>): boolean {
    if (!value || visiting.has(value)) return false;
    if (isSameLocalValue(value, local)) return true;
    visiting.add(value);
    if (typeof value.getOp === "function" && expressionUsesLocal(value.getOp(), local, visiting)) {
        return true;
    }
    for (const use of value.getUses?.() || []) {
        if (expressionUsesLocal(use, local, visiting)) {
            return true;
        }
    }
    return false;
}

interface ModuleMethodIndexItem {
    method: any;
    signature: string;
    methodName: string;
    declaringClassName: string;
}

interface ActiveModuleMethodIndex {
    methods: any[];
    byName: Map<string, any[]>;
    byClassName: Map<string, any[]>;
}

interface SceneModuleMethodIndex {
    items: ModuleMethodIndexItem[];
    all: ActiveModuleMethodIndex;
    byAllowedSet: WeakMap<Set<string>, ActiveModuleMethodIndex>;
}

const emptyActiveModuleMethodIndex: ActiveModuleMethodIndex = {
    methods: [],
    byName: new Map(),
    byClassName: new Map(),
};

const sceneModuleMethodIndexCache = new WeakMap<any, SceneModuleMethodIndex>();

function pushIndexedMethod(map: Map<string, any[]>, key: string, method: any): void {
    if (!key) return;
    let methods = map.get(key);
    if (!methods) {
        methods = [];
        map.set(key, methods);
    }
    methods.push(method);
}

function buildActiveModuleMethodIndex(
    items: ModuleMethodIndexItem[],
    allowedMethodSignatures?: Set<string>,
): ActiveModuleMethodIndex {
    const methods: any[] = [];
    const byName = new Map<string, any[]>();
    const byClassName = new Map<string, any[]>();
    for (const item of items) {
        if (allowedMethodSignatures && !allowedMethodSignatures.has(item.signature)) {
            continue;
        }
        methods.push(item.method);
        pushIndexedMethod(byName, item.methodName, item.method);
        pushIndexedMethod(byClassName, item.declaringClassName, item.method);
    }
    return { methods, byName, byClassName };
}

function getSceneModuleMethodIndex(scene: any): SceneModuleMethodIndex {
    let cached = sceneModuleMethodIndexCache.get(scene);
    if (cached) return cached;
    const items: ModuleMethodIndexItem[] = [];
    for (const method of scene.getMethods?.() || []) {
        if (method.getName?.() === "%dflt") continue;
        const sig = method.getSignature?.();
        const methodName = method.getName?.() || sig?.getMethodSubSignature?.()?.getMethodName?.() || "";
        const declaringClassName = method.getDeclaringArkClass?.()?.getName?.()
            || sig?.getDeclaringClassSignature?.()?.getClassName?.()
            || "";
        items.push({
            method,
            signature: sig?.toString?.() || "",
            methodName,
            declaringClassName,
        });
    }
    cached = {
        items,
        all: buildActiveModuleMethodIndex(items),
        byAllowedSet: new WeakMap(),
    };
    sceneModuleMethodIndexCache.set(scene, cached);
    return cached;
}

function getActiveModuleMethodIndex(raw: InternalRawModuleSetupContext): ActiveModuleMethodIndex {
    if (!raw.scene) {
        return emptyActiveModuleMethodIndex;
    }
    const sceneIndex = getSceneModuleMethodIndex(raw.scene);
    const allowed = raw.allowedMethodSignatures;
    if (!allowed || allowed.size === 0) {
        return sceneIndex.all;
    }
    let active = sceneIndex.byAllowedSet.get(allowed);
    if (!active) {
        active = buildActiveModuleMethodIndex(sceneIndex.items, allowed);
        sceneIndex.byAllowedSet.set(allowed, active);
    }
    return active;
}

function resolveActiveModuleMethods(raw: InternalRawModuleSetupContext): any[] {
    return getActiveModuleMethodIndex(raw).methods;
}

function createMethodsApi(raw: InternalRawModuleSetupContext): ModuleMethodsApi {
    return {
        all(): any[] {
            return getActiveModuleMethodIndex(raw).methods;
        },
    };
}

function resolveMethodMeta(method: any): {
    ownerMethodSignature: string;
    ownerMethodName: string;
    declaringClassName: string;
} {
    const methodSig = method.getSignature?.();
    return {
        ownerMethodSignature: methodSig?.toString?.() || "",
        ownerMethodName: method.getName?.() || methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "",
        declaringClassName: methodSig?.getDeclaringClassSignature?.()?.getClassName?.() || "",
    };
}

function collectCalleeReceiverEndpointNodeIds(
    raw: InternalRawModuleSetupContext,
    analysis: ModuleAnalysisApi,
    args: {
        signature: string;
        methodName: string;
        declaringClassName: string;
        accessPath: string[];
    },
): number[] {
    const accessPath = args.accessPath.map(part => String(part || "").trim()).filter(Boolean);
    if (accessPath.length === 0) return [];
    const methods = resolveCalleeMethods(raw, args);
    const out = new Set<number>();
    for (const method of methods) {
        for (const nodeId of collectReceiverEndpointReadResultNodeIds(method, analysis, accessPath)) {
            out.add(nodeId);
        }
    }
    return [...out.values()];
}

function resolveCalleeMethods(
    raw: InternalRawModuleSetupContext,
    args: {
        signature: string;
        methodName: string;
        declaringClassName: string;
    },
): any[] {
    const methods = getActiveModuleMethodIndex(raw).methods;
    const exact = methods.filter(method => method.getSignature?.().toString?.() === args.signature);
    if (exact.length > 0) return exact;
    return methods.filter(method => {
        const meta = resolveMethodMeta(method);
        return meta.ownerMethodName === args.methodName
            && meta.declaringClassName === args.declaringClassName;
    });
}

function collectReceiverEndpointReadResultNodeIds(
    method: any,
    analysis: ModuleAnalysisApi,
    accessPath: string[],
): number[] {
    const cfg = method.getCfg?.();
    if (!cfg) return [];
    const expressionNodeIds = collectReceiverEndpointExpressionNodeIds(method, analysis, accessPath);
    const stmts = cfg.getStmts?.() || [];
    let baseLocalNames = new Set<string>(["this"]);
    let terminalNodeIds: number[] = [];
    for (const segment of accessPath) {
        const nextBaseLocalNames = new Set<string>();
        const nextNodeIds = new Set<number>();
        for (const stmt of stmts) {
            if (!isAssignStmtLike(stmt)) continue;
            const left = stmt.getLeftOp?.();
            const right = stmt.getRightOp?.();
            if (!isFieldRefLike(right)) continue;
            if (resolveFieldName(right) !== segment) continue;
            const baseLocalName = resolveLocalName(right.getBase?.());
            if (!baseLocalName || !baseLocalNames.has(baseLocalName)) continue;
            const resultLocalName = resolveLocalName(left);
            if (resultLocalName) nextBaseLocalNames.add(resultLocalName);
            for (const nodeId of analysis.exactEndpointNodeIdsForValue(left, stmt)) nextNodeIds.add(nodeId);
            for (const nodeId of analysis.carrierNodeIdsForValue(left, stmt)) nextNodeIds.add(nodeId);
        }
        terminalNodeIds = [...nextNodeIds.values()];
        if (terminalNodeIds.length === 0) return expressionNodeIds;
        baseLocalNames = nextBaseLocalNames;
        if (baseLocalNames.size === 0 && segment !== accessPath[accessPath.length - 1]) {
            return expressionNodeIds;
        }
    }
    if (expressionNodeIds.length > 0) {
        return [...new Set<number>([...terminalNodeIds, ...expressionNodeIds])];
    }
    return terminalNodeIds;
}

function collectReceiverEndpointExpressionNodeIds(
    method: any,
    analysis: ModuleAnalysisApi,
    accessPath: string[],
): number[] {
    const cfg = method.getCfg?.();
    if (!cfg) return [];
    const out = new Set<number>();
    const localPathAliases = new Map<string, string[]>();
    localPathAliases.set("this", []);

    const addValueNodes = (value: any, stmt: any): void => {
        for (const nodeId of analysis.exactEndpointNodeIdsForValue(value, stmt)) out.add(nodeId);
        for (const nodeId of analysis.carrierNodeIdsForValue(value, stmt)) out.add(nodeId);
    };

    for (const stmt of cfg.getStmts?.() || []) {
        const valuesToInspect: any[] = [];
        if (isAssignStmtLike(stmt)) {
            const left = stmt.getLeftOp?.();
            const right = stmt.getRightOp?.();
            valuesToInspect.push(right);
            for (const used of collectValueUseTree(right)) {
                if (fieldAccessPathEquals(resolveReceiverFieldAccessPath(used, localPathAliases), accessPath)) {
                    addValueNodes(used, stmt);
                    addValueNodes(left, stmt);
                }
            }
            const leftName = resolveLocalName(left);
            const rightPath = resolveReceiverFieldAccessPath(right, localPathAliases);
            if (leftName && rightPath) {
                localPathAliases.set(leftName, rightPath);
            }
        }

        const returnValue = resolveReturnValue(stmt);
        if (returnValue !== undefined) {
            valuesToInspect.push(returnValue);
        }

        if (stmt.containsInvokeExpr?.()) {
            const invokeExpr = stmt.getInvokeExpr?.();
            if (invokeExpr) {
                valuesToInspect.push(invokeExpr.getBase?.());
                for (const arg of invokeExpr.getArgs?.() || []) {
                    valuesToInspect.push(arg);
                }
            }
        }

        for (const value of valuesToInspect) {
            for (const used of collectValueUseTree(value)) {
                if (fieldAccessPathEquals(resolveReceiverFieldAccessPath(used, localPathAliases), accessPath)) {
                    addValueNodes(used, stmt);
                }
            }
        }
    }

    return [...out.values()];
}

function matchesOwnerScanFilter(
    ownerMethodSignature: string,
    ownerMethodName: string,
    declaringClassName: string,
    filter?: {
        ownerMethodSignature?: string;
        ownerMethodName?: string;
        declaringClassName?: string;
    },
): boolean {
    if (!filter) return true;
    if (filter.ownerMethodSignature && filter.ownerMethodSignature !== ownerMethodSignature) return false;
    if (filter.ownerMethodName && filter.ownerMethodName !== ownerMethodName) return false;
    if (filter.declaringClassName && filter.declaringClassName !== declaringClassName) return false;
    return true;
}

function isConstructorInvokeSignature(methodName: string, signature: string): boolean {
    return methodName === "constructor" || String(signature || "").includes(".constructor(");
}

function matchesConstructScanFilter(
    methodName: string,
    signature: string,
): boolean {
    if (!isConstructorInvokeSignature(methodName, signature)) return false;
    return true;
}

const CANONICAL_API_OCCURRENCE_INDEX = Symbol("moduleCanonicalApiOccurrenceIndex");
const CANONICAL_DECORATED_FIELD_INDEX = Symbol("moduleCanonicalDecoratedFieldIndex");

function canonicalApiIdsFromFilter(
    filter: Pick<ModuleInvokeScanFilter, "canonicalApiId" | "canonicalApiIds">,
    scanKind: "scan.invokes" | "scan.constructs",
): Set<string> {
    const values = [
        filter.canonicalApiId,
        ...(filter.canonicalApiIds || []),
    ].map(item => String(item || "").trim()).filter(Boolean);
    if (values.length === 0) {
        throw new ModuleRuntimeDiagnosticError(
            `${scanKind} requires at least one canonicalApiId from an accepted occurrence`,
            "MODULE_CANONICAL_SCAN_FILTER_REQUIRED",
            "Module scan APIs are canonical-only. Pass a non-empty canonicalApiId or canonicalApiIds selector and do not scan ordinary invokes by method name.",
        );
    }
    return new Set(values);
}

function canonicalDecoratorApiIdsFromFilter(
    filter: ModuleDecoratedFieldScanFilter | undefined,
): Set<string> {
    const values = [
        filter?.decoratorCanonicalApiId,
        ...(filter?.decoratorCanonicalApiIds || []),
    ].map(item => String(item || "").trim()).filter(Boolean);
    if (values.length === 0) {
        throw new ModuleRuntimeDiagnosticError(
            "scan.decoratedFields requires at least one decorator canonicalApiId from an accepted occurrence",
            "MODULE_CANONICAL_DECORATOR_SCAN_FILTER_REQUIRED",
            "Decorator module scan APIs are canonical-only. Pass non-empty decoratorCanonicalApiId or decoratorCanonicalApiIds and do not scan decorators by kind/name.",
        );
    }
    return new Set(values);
}

function canonicalApiOccurrencesByStmt(
    raw: InternalRawModuleSetupContext,
): WeakMap<object, ModuleCanonicalApiOccurrence[]> {
    const cached = (raw as any)[CANONICAL_API_OCCURRENCE_INDEX] as WeakMap<object, ModuleCanonicalApiOccurrence[]> | undefined;
    if (cached) return cached;
    const index = new WeakMap<object, ModuleCanonicalApiOccurrence[]>();
    const seen = new Set<string>();
    for (const occurrence of raw.canonicalApiOccurrences || []) {
        const stmt = occurrence.stmt;
        if (!stmt || (typeof stmt !== "object" && typeof stmt !== "function")) continue;
        if (!occurrence.canonicalApiId || !occurrence.occurrenceId || !occurrence.rawOccurrenceId) continue;
        const key = `${occurrence.occurrenceId}|${occurrence.canonicalApiId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const bucket = index.get(stmt) || [];
        bucket.push(occurrence);
        index.set(stmt, bucket);
    }
    (raw as any)[CANONICAL_API_OCCURRENCE_INDEX] = index;
    return index;
}

function selectCanonicalApiOccurrence(
    raw: InternalRawModuleSetupContext,
    stmt: any,
    expectedCanonicalApiIds: Set<string>,
): ModuleCanonicalApiOccurrence | undefined {
    if (!stmt || (typeof stmt !== "object" && typeof stmt !== "function")) return undefined;
    const occurrences = canonicalApiOccurrencesByStmt(raw).get(stmt) || [];
    return occurrences.find(item => expectedCanonicalApiIds.has(item.canonicalApiId));
}

interface CanonicalDecoratedFieldGroup {
    className: string;
    fieldName: string;
    fieldSignature: string;
    decorators: ModuleScannedDecorator[];
}

function canonicalDecoratedFieldsByApiId(
    raw: InternalRawModuleSetupContext,
): Map<string, CanonicalDecoratedFieldGroup[]> {
    const cached = (raw as any)[CANONICAL_DECORATED_FIELD_INDEX] as Map<string, CanonicalDecoratedFieldGroup[]> | undefined;
    if (cached) return cached;
    const groupedByField = new Map<string, CanonicalDecoratedFieldGroup>();
    const apiIdsByFieldKey = new Map<string, Set<string>>();
    for (const occurrence of raw.canonicalDecoratorOccurrences || []) {
        if (occurrence.ownerKind !== "field") continue;
        if (!occurrence.canonicalApiId || !occurrence.occurrenceId || !occurrence.rawOccurrenceId) continue;
        const meta = decoratedFieldMeta(occurrence.model);
        if (!meta) continue;
        const fieldKey = meta.fieldSignature || `${meta.className}#${meta.fieldName}`;
        const group = groupedByField.get(fieldKey) || {
            className: meta.className,
            fieldName: meta.fieldName,
            fieldSignature: meta.fieldSignature,
            decorators: [],
        };
        if (!groupedByField.has(fieldKey)) {
            groupedByField.set(fieldKey, group);
        }
        const decoratorKey = [
            occurrence.canonicalApiId,
            occurrence.decorator.kind,
            occurrence.decorator.param || "",
            occurrence.decorator.content || "",
        ].join("\u001f");
        if (!group.decorators.some(item => [
            item.canonicalApiId || "",
            item.kind,
            item.param || "",
            item.content || "",
        ].join("\u001f") === decoratorKey)) {
            group.decorators.push({
                kind: occurrence.decorator.kind,
                canonicalApiId: occurrence.canonicalApiId,
                param: occurrence.decorator.param,
                content: occurrence.decorator.content,
            });
        }
        const ids = apiIdsByFieldKey.get(fieldKey) || new Set<string>();
        ids.add(occurrence.canonicalApiId);
        apiIdsByFieldKey.set(fieldKey, ids);
    }
    const byApiId = new Map<string, CanonicalDecoratedFieldGroup[]>();
    for (const [fieldKey, apiIds] of apiIdsByFieldKey.entries()) {
        const group = groupedByField.get(fieldKey);
        if (!group) continue;
        for (const apiId of apiIds) {
            const bucket = byApiId.get(apiId) || [];
            bucket.push(group);
            byApiId.set(apiId, bucket);
        }
    }
    (raw as any)[CANONICAL_DECORATED_FIELD_INDEX] = byApiId;
    return byApiId;
}

function decoratedFieldMeta(model: any): { className: string; fieldName: string; fieldSignature: string } | undefined {
    const fieldName = String(
        model?.getName?.()
            || model?.getSignature?.()?.getFieldName?.()
            || "",
    ).trim();
    const fieldSignature = String(model?.getSignature?.()?.toString?.() || "").trim();
    const className = String(
        model?.getDeclaringArkClass?.()?.getName?.()
            || classNameFromFieldSignature(fieldSignature)
            || "",
    ).trim();
    if (!fieldName || !className) return undefined;
    return { className, fieldName, fieldSignature };
}

function classNameFromFieldSignature(signature: string): string | undefined {
    const text = String(signature || "");
    const match = text.match(/:\s*([^.\s>]+)\.[^.\s>]+>?$/);
    return match?.[1];
}

function matchesDecoratedFieldFilter(
    group: CanonicalDecoratedFieldGroup,
    filter: ModuleDecoratedFieldScanFilter | undefined,
): boolean {
    if (filter?.className && filter.className !== group.className) return false;
    if (filter?.fieldName && filter.fieldName !== group.fieldName) return false;
    if (filter?.fieldSignature && filter.fieldSignature !== group.fieldSignature) return false;
    return true;
}

function isInvokeExprLike(value: any): boolean {
    return !!value
        && typeof value.getMethodSignature === "function"
        && typeof value.getArgs === "function";
}

function isInstanceInvokeExprLike(value: any): boolean {
    return !!value && typeof value.getBase === "function";
}

function isAssignStmtLike(value: any): boolean {
    return !!value
        && typeof value.getLeftOp === "function"
        && typeof value.getRightOp === "function";
}

function isFieldRefLike(value: any): boolean {
    return !!value
        && typeof value.getBase === "function"
        && typeof value.getFieldSignature === "function";
}

function isParameterRefLike(value: any): boolean {
    return !!value && typeof value.getIndex === "function";
}

function resolveFieldName(fieldRef: any): string {
    return fieldRef?.getFieldSignature?.()?.getFieldName?.() || "";
}

function resolveLocalName(value: any): string | undefined {
    const name = value?.getName?.();
    return typeof name === "string" && name.length > 0 ? name : undefined;
}

function resolveReturnValue(stmt: any): any | undefined {
    if (!stmt) return undefined;
    if (typeof stmt.getOp === "function") return stmt.getOp();
    if (typeof stmt.getReturnValue === "function") return stmt.getReturnValue();
    return undefined;
}

function collectValueUseTree(value: any): any[] {
    const out: any[] = [];
    const seen = new Set<any>();
    const visit = (current: any): void => {
        if (!current || seen.has(current)) return;
        seen.add(current);
        out.push(current);
        for (const used of current.getUses?.() || []) {
            visit(used);
        }
        if (isFieldRefLike(current)) {
            visit(current.getBase?.());
        }
        if (typeof current.getOp1 === "function") {
            visit(current.getOp1());
        }
        if (typeof current.getOp2 === "function") {
            visit(current.getOp2());
        }
        if (typeof current.getOp === "function") {
            visit(current.getOp());
        }
        for (const arg of current.getArgs?.() || []) {
            visit(arg);
        }
    };
    visit(value);
    return out;
}

function resolveReceiverFieldAccessPath(value: any, localPathAliases: Map<string, string[]>): string[] | undefined {
    if (!isFieldRefLike(value)) return undefined;
    const fieldName = resolveFieldName(value);
    if (!fieldName) return undefined;
    const base = value.getBase?.();
    const baseName = resolveLocalName(base);
    if (baseName && localPathAliases.has(baseName)) {
        return [...(localPathAliases.get(baseName) || []), fieldName];
    }
    const basePath = resolveReceiverFieldAccessPath(base, localPathAliases);
    return basePath ? [...basePath, fieldName] : undefined;
}

function fieldAccessPathEquals(actual: string[] | undefined, expected: string[]): boolean {
    if (!actual || actual.length !== expected.length) return false;
    for (let i = 0; i < expected.length; i++) {
        if (actual[i] !== expected[i]) return false;
    }
    return true;
}

function isSameLocalValue(a: any, b: any): boolean {
    if (!a || !b) return false;
    if (a === b) return true;
    const aName = resolveLocalName(a);
    const bName = resolveLocalName(b);
    return !!aName && aName === bName;
}

function isThisLocal(value: any): boolean {
    return resolveLocalName(value) === "this";
}

function matchesBaseLocalFilter(
    base: any,
    filter?: {
        baseLocalName?: string;
        baseLocalNames?: string[];
        baseThisOnly?: boolean;
    },
): boolean {
    if (!filter) return true;
    if (filter.baseThisOnly && !isThisLocal(base)) return false;
    const baseLocalName = resolveLocalName(base);
    if (filter.baseLocalName && filter.baseLocalName !== baseLocalName) return false;
    if (filter.baseLocalNames && filter.baseLocalNames.length > 0) {
        if (!baseLocalName || !filter.baseLocalNames.includes(baseLocalName)) return false;
    }
    return true;
}

function matchesSourceLocalFilter(
    value: any,
    filter?: {
        sourceLocalName?: string;
        sourceLocalNames?: string[];
    },
): boolean {
    if (!filter) return true;
    const sourceLocalName = resolveLocalName(value);
    if (filter.sourceLocalName && filter.sourceLocalName !== sourceLocalName) return false;
    if (filter.sourceLocalNames && filter.sourceLocalNames.length > 0) {
        if (!sourceLocalName || !filter.sourceLocalNames.includes(sourceLocalName)) return false;
    }
    return true;
}

function normalizeDecoratorEntry(decorator: any): ModuleScannedDecorator | undefined {
    const kind = String(decorator?.getKind?.() || "").trim();
    if (!kind) return undefined;
    const content = String(decorator?.getContent?.() || "").trim();
    const rawParam = String(decorator?.getParam?.() || "").trim();
    const contentParam = content.match(/\(\s*['"`]([^'"`]+)['"`]\s*\)/)?.[1]?.trim() || "";
    const param = rawParam || contentParam;
    return {
        kind,
        param: param || undefined,
        content: content || undefined,
    };
}

function createScanApi(raw: InternalRawModuleSetupContext): ModuleScanApi {
    let methods: any[] | undefined;
    const getMethods = (): any[] => {
        if (!methods) {
            methods = resolveActiveModuleMethods(raw);
        }
        return methods;
    };
    let analysis: ModuleAnalysisApi | undefined;
    const getAnalysis = (): ModuleAnalysisApi => {
        if (!analysis) {
            analysis = createAnalysisApi(raw);
        }
        return analysis;
    };
    return {
        invokes(filter: ModuleInvokeScanFilter): ModuleScannedInvoke[] {
            const out: ModuleScannedInvoke[] = [];
            const expectedCanonicalApiIds = canonicalApiIdsFromFilter(filter, "scan.invokes");
            for (const method of getMethods()) {
                assertModuleSetupBudget(raw, "scan.invokes");
                const ownerMethodSignature = method.getSignature?.().toString?.() || "";
                const ownerDeclaringClassName = method.getDeclaringArkClass?.()?.getName?.()
                    || method.getSignature?.()?.getDeclaringClassSignature?.()?.getClassName?.()
                    || "";
                const cfg = method.getCfg?.();
                if (!cfg) continue;
                for (const stmt of cfg.getStmts()) {
                    assertModuleSetupBudget(raw, "scan.invokes");
                    if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
                    const invokeExpr = stmt.getInvokeExpr();
                    if (!isInvokeExprLike(invokeExpr)) {
                        continue;
                    }
                    const methodSig = invokeExpr.getMethodSignature?.();
                    const signature = methodSig?.toString?.() || "";
                    const methodName = methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "";
                    const declaringClassName = methodSig?.getDeclaringClassSignature?.()?.getClassName?.() || "";
                    const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
                    const isInstanceInvoke = isInstanceInvokeExprLike(invokeExpr);
                    const canonicalOccurrence = selectCanonicalApiOccurrence(raw, stmt, expectedCanonicalApiIds);
                    if (!canonicalOccurrence) {
                        continue;
                    }
                    const resultValue = typeof stmt.getLeftOp === "function"
                        ? stmt.getLeftOp()
                        : undefined;
                    out.push({
                        ownerMethodSignature,
                        ownerDeclaringClassName,
                        stmt,
                        invokeExpr,
                        call: {
                            signature,
                            methodName,
                            declaringClassName,
                            argCount: args.length,
                            canonicalApiId: canonicalOccurrence.canonicalApiId,
                            occurrenceId: canonicalOccurrence.occurrenceId,
                            rawOccurrenceId: canonicalOccurrence.rawOccurrenceId,
                            semanticEffectSites: [...canonicalOccurrence.semanticEffectSites],
                        },
                        arg(index: number): any | undefined {
                            return index >= 0 && index < args.length ? args[index] : undefined;
                        },
                        args(): any[] {
                            return [...args];
                        },
                        base(): any | undefined {
                            return isInstanceInvoke
                                ? invokeExpr.getBase()
                                : undefined;
                        },
                        result(): any | undefined {
                            return resultValue;
                        },
                        argNodeIds(index: number): number[] {
                            const value = index >= 0 && index < args.length ? args[index] : undefined;
                            return getAnalysis().nodeIdsForValue(value, stmt);
                        },
                        argObjectNodeIds(index: number): number[] {
                            const value = index >= 0 && index < args.length ? args[index] : undefined;
                            return getAnalysis().objectNodeIdsForValue(value);
                        },
                        argCarrierNodeIds(index: number): number[] {
                            const value = index >= 0 && index < args.length ? args[index] : undefined;
                            return getAnalysis().carrierNodeIdsForValue(value, stmt);
                        },
                        baseNodeIds(): number[] {
                            if (!isInstanceInvoke) return [];
                            return getAnalysis().nodeIdsForValue(invokeExpr.getBase(), stmt);
                        },
                        baseObjectNodeIds(): number[] {
                            if (!isInstanceInvoke) return [];
                            return getAnalysis().objectNodeIdsForValue(invokeExpr.getBase());
                        },
                        baseCarrierNodeIds(): number[] {
                            if (!isInstanceInvoke) return [];
                            return getAnalysis().carrierNodeIdsForValue(invokeExpr.getBase(), stmt);
                        },
                        semanticEndpointNodeIds(selector: { kind: string; index?: number; nodeKind?: string; rest?: boolean }): number[] {
                            return collectConsumableSemanticEndpointNodeIds({
                                analysis: getAnalysis(),
                                semanticEffectSites: canonicalOccurrence.semanticEffectSites,
                                stmt,
                                invokeExpr,
                                selector,
                            });
                        },
                        calleeReceiverEndpointNodeIds(accessPath: string[]): number[] {
                            if (!isInstanceInvoke) return [];
                            return collectCalleeReceiverEndpointNodeIds(raw, getAnalysis(), {
                                signature,
                                methodName,
                                declaringClassName,
                                accessPath,
                            });
                        },
                        resultNodeIds(): number[] {
                            return collectModuleResultEndpointNodeIds(getAnalysis(), resultValue, stmt);
                        },
                        resultCarrierNodeIds(): number[] {
                            return collectModuleResultEndpointCarrierNodeIds(getAnalysis(), resultValue, stmt);
                        },
                        promiseResultNodeIds(): number[] {
                            return collectModulePromiseResultEndpointNodeIds(method, getAnalysis(), resultValue, stmt);
                        },
                        callbackParamNodeIds(
                            callbackArgIndex: number,
                            paramIndex: number,
                            options = {},
                        ): number[] {
                            const callbackValue = callbackArgIndex >= 0 && callbackArgIndex < args.length
                                ? args[callbackArgIndex]
                                : undefined;
                            return collectCallbackParamNodeIdsWithQueries(
                                raw.scene,
                                raw.pag,
                                raw.queries,
                                callbackValue,
                                paramIndex,
                                options,
                            );
                        },
                    });
                }
            }
            return out;
        },
        constructs(filter: ModuleConstructScanFilter): ModuleScannedInvoke[] {
            const out: ModuleScannedInvoke[] = [];
            const expectedCanonicalApiIds = canonicalApiIdsFromFilter(filter, "scan.constructs");
            for (const method of getMethods()) {
                assertModuleSetupBudget(raw, "scan.constructs");
                const ownerMethodSignature = method.getSignature?.().toString?.() || "";
                const ownerDeclaringClassName = method.getDeclaringArkClass?.()?.getName?.()
                    || method.getSignature?.()?.getDeclaringClassSignature?.()?.getClassName?.()
                    || "";
                const cfg = method.getCfg?.();
                if (!cfg) continue;
                for (const stmt of cfg.getStmts()) {
                    assertModuleSetupBudget(raw, "scan.constructs");
                    if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
                    const invokeExpr = stmt.getInvokeExpr();
                    if (!isInvokeExprLike(invokeExpr)) {
                        continue;
                    }
                    const methodSig = invokeExpr.getMethodSignature?.();
                    const signature = methodSig?.toString?.() || "";
                    const methodName = methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "";
                    const declaringClassName = methodSig?.getDeclaringClassSignature?.()?.getClassName?.() || "";
                    const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
                    const canonicalOccurrence = selectCanonicalApiOccurrence(raw, stmt, expectedCanonicalApiIds);
                    if (!canonicalOccurrence) {
                        continue;
                    }
                    if (!matchesConstructScanFilter(methodName, signature)) {
                        continue;
                    }
                    const isInstanceInvoke = isInstanceInvokeExprLike(invokeExpr);
                    const resultValue = typeof stmt.getLeftOp === "function"
                        ? stmt.getLeftOp()
                        : undefined;
                    out.push({
                        ownerMethodSignature,
                        ownerDeclaringClassName,
                        stmt,
                        invokeExpr,
                        call: {
                            signature,
                            methodName,
                            declaringClassName,
                            argCount: args.length,
                            canonicalApiId: canonicalOccurrence.canonicalApiId,
                            occurrenceId: canonicalOccurrence.occurrenceId,
                            rawOccurrenceId: canonicalOccurrence.rawOccurrenceId,
                            semanticEffectSites: [...canonicalOccurrence.semanticEffectSites],
                        },
                        arg(index: number): any | undefined {
                            return index >= 0 && index < args.length ? args[index] : undefined;
                        },
                        args(): any[] {
                            return [...args];
                        },
                        base(): any | undefined {
                            return isInstanceInvoke
                                ? invokeExpr.getBase()
                                : undefined;
                        },
                        result(): any | undefined {
                            return resultValue;
                        },
                        argNodeIds(index: number): number[] {
                            const value = index >= 0 && index < args.length ? args[index] : undefined;
                            return getAnalysis().nodeIdsForValue(value, stmt);
                        },
                        argObjectNodeIds(index: number): number[] {
                            const value = index >= 0 && index < args.length ? args[index] : undefined;
                            return getAnalysis().objectNodeIdsForValue(value);
                        },
                        argCarrierNodeIds(index: number): number[] {
                            const value = index >= 0 && index < args.length ? args[index] : undefined;
                            return getAnalysis().carrierNodeIdsForValue(value, stmt);
                        },
                        baseNodeIds(): number[] {
                            if (!isInstanceInvoke) return [];
                            return getAnalysis().nodeIdsForValue(invokeExpr.getBase(), stmt);
                        },
                        baseObjectNodeIds(): number[] {
                            if (!isInstanceInvoke) return [];
                            return getAnalysis().objectNodeIdsForValue(invokeExpr.getBase());
                        },
                        baseCarrierNodeIds(): number[] {
                            if (!isInstanceInvoke) return [];
                            return getAnalysis().carrierNodeIdsForValue(invokeExpr.getBase(), stmt);
                        },
                        semanticEndpointNodeIds(selector: { kind: string; index?: number; nodeKind?: string; rest?: boolean }): number[] {
                            return collectConsumableSemanticEndpointNodeIds({
                                analysis: getAnalysis(),
                                semanticEffectSites: canonicalOccurrence.semanticEffectSites,
                                stmt,
                                invokeExpr,
                                selector,
                            });
                        },
                        calleeReceiverEndpointNodeIds(accessPath: string[]): number[] {
                            if (!isInstanceInvoke) return [];
                            return collectCalleeReceiverEndpointNodeIds(raw, getAnalysis(), {
                                signature,
                                methodName,
                                declaringClassName,
                                accessPath,
                            });
                        },
                        resultNodeIds(): number[] {
                            return collectModuleResultEndpointNodeIds(getAnalysis(), resultValue, stmt);
                        },
                        resultCarrierNodeIds(): number[] {
                            return collectModuleResultEndpointCarrierNodeIds(getAnalysis(), resultValue, stmt);
                        },
                        promiseResultNodeIds(): number[] {
                            return collectModulePromiseResultEndpointNodeIds(method, getAnalysis(), resultValue, stmt);
                        },
                        callbackParamNodeIds(
                            callbackArgIndex: number,
                            paramIndex: number,
                            options = {},
                        ): number[] {
                            const callbackValue = callbackArgIndex >= 0 && callbackArgIndex < args.length
                                ? args[callbackArgIndex]
                                : undefined;
                            return collectCallbackParamNodeIdsWithQueries(
                                raw.scene,
                                raw.pag,
                                raw.queries,
                                callbackValue,
                                paramIndex,
                                options,
                            );
                        },
                    });
                }
            }
            return out;
        },
        parameterBindings(filter?: ModuleParameterBindingScanFilter): ModuleScannedParameterBinding[] {
            const out: ModuleScannedParameterBinding[] = [];
            for (const method of getMethods()) {
                assertModuleSetupBudget(raw, "scan.parameterBindings");
                const meta = resolveMethodMeta(method);
                if (!matchesOwnerScanFilter(
                    meta.ownerMethodSignature,
                    meta.ownerMethodName,
                    meta.declaringClassName,
                    filter,
                )) {
                    continue;
                }
                const parameters = method.getParameters?.() || [];
                const cfg = method.getCfg?.();
                if (!cfg) continue;
                for (const stmt of cfg.getStmts()) {
                    assertModuleSetupBudget(raw, "scan.parameterBindings");
                    if (!isAssignStmtLike(stmt)) continue;
                    const right = stmt.getRightOp();
                    if (!isParameterRefLike(right)) continue;
                    const paramIndex = right.getIndex();
                    const parameter = parameters[paramIndex];
                    const paramName = String(parameter?.getName?.() || "");
                    const paramType = String(parameter?.getType?.()?.toString?.() || "");
                    const left = stmt.getLeftOp();
                    const localName = resolveLocalName(left);
                    if (filter?.paramIndex !== undefined && filter.paramIndex !== paramIndex) continue;
                    if (filter?.paramName && filter.paramName !== paramName) continue;
                    if (filter?.paramType && filter.paramType !== paramType) continue;
                    if (filter?.localName && filter.localName !== localName) continue;
                    out.push({
                        ...meta,
                        stmt,
                        paramIndex,
                        paramName,
                        paramType,
                        local(): any | undefined {
                            return left;
                        },
                        localName(): string | undefined {
                            return localName;
                        },
                        localNodeIds(): number[] {
                            return getAnalysis().nodeIdsForValue(left, stmt);
                        },
                        localUseNodeIds(): number[] {
                            return collectExactLocalUseNodeIds(raw.pag, method, left, stmt);
                        },
                        localObjectNodeIds(): number[] {
                            return getAnalysis().objectNodeIdsForValue(left);
                        },
                        localCarrierNodeIds(): number[] {
                            return getAnalysis().carrierNodeIdsForValue(left, stmt);
                        },
                    });
                }
            }
            return out;
        },
        assigns(filter?: ModuleAssignScanFilter): ModuleScannedAssign[] {
            const out: ModuleScannedAssign[] = [];
            for (const method of getMethods()) {
                assertModuleSetupBudget(raw, "scan.assigns");
                const meta = resolveMethodMeta(method);
                if (!matchesOwnerScanFilter(
                    meta.ownerMethodSignature,
                    meta.ownerMethodName,
                    meta.declaringClassName,
                    filter,
                )) {
                    continue;
                }
                const cfg = method.getCfg?.();
                if (!cfg) continue;
                for (const stmt of cfg.getStmts()) {
                    assertModuleSetupBudget(raw, "scan.assigns");
                    if (!isAssignStmtLike(stmt)) continue;
                    const left = stmt.getLeftOp();
                    const right = stmt.getRightOp();
                    const leftLocalName = resolveLocalName(left);
                    const rightLocalName = resolveLocalName(right);
                    if (filter?.leftLocalName && filter.leftLocalName !== leftLocalName) continue;
                    if (filter?.rightLocalName && filter.rightLocalName !== rightLocalName) continue;
                    out.push({
                        ...meta,
                        stmt,
                        left(): any | undefined {
                            return left;
                        },
                        leftLocalName(): string | undefined {
                            return leftLocalName;
                        },
                        right(): any | undefined {
                            return right;
                        },
                        rightLocalName(): string | undefined {
                            return rightLocalName;
                        },
                        leftNodeIds(): number[] {
                            return getAnalysis().nodeIdsForValue(left, stmt);
                        },
                        leftCarrierNodeIds(): number[] {
                            return getAnalysis().carrierNodeIdsForValue(left, stmt);
                        },
                        rightNodeIds(): number[] {
                            return getAnalysis().nodeIdsForValue(right, stmt);
                        },
                        rightCarrierNodeIds(): number[] {
                            return getAnalysis().carrierNodeIdsForValue(right, stmt);
                        },
                    });
                }
            }
            return out;
        },
        fieldLoads(filter?: ModuleFieldLoadScanFilter): ModuleScannedFieldLoad[] {
            const out: ModuleScannedFieldLoad[] = [];
            for (const method of getMethods()) {
                assertModuleSetupBudget(raw, "scan.fieldLoads");
                const meta = resolveMethodMeta(method);
                if (!matchesOwnerScanFilter(
                    meta.ownerMethodSignature,
                    meta.ownerMethodName,
                    meta.declaringClassName,
                    filter,
                )) {
                    continue;
                }
                const cfg = method.getCfg?.();
                if (!cfg) continue;
                for (const stmt of cfg.getStmts()) {
                    assertModuleSetupBudget(raw, "scan.fieldLoads");
                    if (!isAssignStmtLike(stmt)) continue;
                    const left = stmt.getLeftOp();
                    const right = stmt.getRightOp();
                    if (!isFieldRefLike(right)) continue;
                    const base = right.getBase();
                    const fieldName = resolveFieldName(right);
                    const fieldSignature = right.getFieldSignature?.()?.toString?.() || "";
                    if (!fieldName) continue;
                    if (filter?.fieldName && filter.fieldName !== fieldName) continue;
                    if (filter?.fieldSignature && filter.fieldSignature !== fieldSignature) continue;
                    if (!matchesBaseLocalFilter(base, filter)) continue;
                    out.push({
                        ...meta,
                        stmt,
                        fieldName,
                        fieldSignature,
                        base(): any | undefined {
                            return base;
                        },
                        baseIsThis(): boolean {
                            return isThisLocal(base);
                        },
                        baseLocalName(): string | undefined {
                            return resolveLocalName(base);
                        },
                        result(): any | undefined {
                            return left;
                        },
                        resultLocalName(): string | undefined {
                            return resolveLocalName(left);
                        },
                        baseNodeIds(): number[] {
                            return getAnalysis().nodeIdsForValue(base, stmt);
                        },
                        baseObjectNodeIds(): number[] {
                            return getAnalysis().objectNodeIdsForValue(base);
                        },
                        baseCarrierNodeIds(): number[] {
                            return getAnalysis().carrierNodeIdsForValue(base, stmt);
                        },
                        resultNodeIds(): number[] {
                            return getAnalysis().nodeIdsForValue(left, stmt);
                        },
                        resultObjectNodeIds(): number[] {
                            return getAnalysis().objectNodeIdsForValue(left);
                        },
                        resultCarrierNodeIds(): number[] {
                            return getAnalysis().carrierNodeIdsForValue(left, stmt);
                        },
                    });
                }
            }
            return out;
        },
        fieldStores(filter?: ModuleFieldStoreScanFilter): ModuleScannedFieldStore[] {
            const out: ModuleScannedFieldStore[] = [];
            for (const method of getMethods()) {
                assertModuleSetupBudget(raw, "scan.fieldStores");
                const meta = resolveMethodMeta(method);
                if (!matchesOwnerScanFilter(
                    meta.ownerMethodSignature,
                    meta.ownerMethodName,
                    meta.declaringClassName,
                    filter,
                )) {
                    continue;
                }
                const cfg = method.getCfg?.();
                if (!cfg) continue;
                for (const stmt of cfg.getStmts()) {
                    assertModuleSetupBudget(raw, "scan.fieldStores");
                    if (!isAssignStmtLike(stmt)) continue;
                    const left = stmt.getLeftOp();
                    const right = stmt.getRightOp();
                    if (!isFieldRefLike(left)) continue;
                    const base = left.getBase();
                    const fieldName = resolveFieldName(left);
                    const fieldSignature = left.getFieldSignature?.()?.toString?.() || "";
                    if (!fieldName) continue;
                    if (filter?.fieldName && filter.fieldName !== fieldName) continue;
                    if (filter?.fieldSignature && filter.fieldSignature !== fieldSignature) continue;
                    if (!matchesBaseLocalFilter(base, filter)) continue;
                    if (!matchesSourceLocalFilter(right, filter)) continue;
                    out.push({
                        ...meta,
                        stmt,
                        fieldName,
                        fieldSignature,
                        base(): any | undefined {
                            return base;
                        },
                        baseIsThis(): boolean {
                            return isThisLocal(base);
                        },
                        baseLocalName(): string | undefined {
                            return resolveLocalName(base);
                        },
                        value(): any | undefined {
                            return right;
                        },
                        valueLocalName(): string | undefined {
                            return resolveLocalName(right);
                        },
                        baseNodeIds(): number[] {
                            return getAnalysis().nodeIdsForValue(base, stmt);
                        },
                        baseObjectNodeIds(): number[] {
                            return getAnalysis().objectNodeIdsForValue(base);
                        },
                        baseCarrierNodeIds(): number[] {
                            return getAnalysis().carrierNodeIdsForValue(base, stmt);
                        },
                        valueNodeIds(): number[] {
                            return getAnalysis().nodeIdsForValue(right, stmt);
                        },
                        valueObjectNodeIds(): number[] {
                            return getAnalysis().objectNodeIdsForValue(right);
                        },
                        valueCarrierNodeIds(): number[] {
                            return getAnalysis().carrierNodeIdsForValue(right, stmt);
                        },
                    });
                }
            }
            return out;
        },
        decoratedFields(filter?: ModuleDecoratedFieldScanFilter): ModuleScannedDecoratedField[] {
            const canonicalApiIds = canonicalDecoratorApiIdsFromFilter(filter);
            const groupsByKey = new Map<string, CanonicalDecoratedFieldGroup>();
            const byApiId = canonicalDecoratedFieldsByApiId(raw);
            for (const canonicalApiId of canonicalApiIds) {
                for (const group of byApiId.get(canonicalApiId) || []) {
                    if (!matchesDecoratedFieldFilter(group, filter)) continue;
                    const key = group.fieldSignature || `${group.className}#${group.fieldName}`;
                    if (!groupsByKey.has(key)) groupsByKey.set(key, group);
                }
            }
            return [...groupsByKey.values()].map(group => ({
                className: group.className,
                fieldName: group.fieldName,
                fieldSignature: group.fieldSignature,
                decorators(): ModuleScannedDecorator[] {
                    return group.decorators.map(item => ({ ...item }));
                },
            }));
        },
    };
}

function normalizeFieldPathInput(fieldPath: string | string[]): string[] {
    return Array.isArray(fieldPath) ? [...fieldPath] : [fieldPath];
}

function createBridgeApi(): ModuleBridgeApi {
    const createNodeRelayImpl = (): ModuleNodeRelay => {
        const targetsBySourceNodeId = new Map<number, Set<number>>();
        const ensureTargets = (sourceNodeId: number): Set<number> => {
            let targets = targetsBySourceNodeId.get(sourceNodeId);
            if (!targets) {
                targets = new Set<number>();
                targetsBySourceNodeId.set(sourceNodeId, targets);
            }
            return targets;
        };
        const connectPair = (sourceNodeId: number, targetNodeId: number): boolean => {
            const targets = ensureTargets(sourceNodeId);
            const before = targets.size;
            targets.add(targetNodeId);
            return targets.size !== before;
        };
        const resolveInvokeSourceNodeIds = (
            call: ModuleScannedInvoke,
            sourceArgIndex: number,
            sourceKind: "node" | "carrier" | "object",
        ): number[] => {
            if (sourceKind === "carrier") {
                return call.argCarrierNodeIds(sourceArgIndex);
            }
            if (sourceKind === "object") {
                return call.argObjectNodeIds(sourceArgIndex);
            }
            return call.argNodeIds(sourceArgIndex);
        };
        return {
            connect(sourceNodeId: number, targetNodeId: number): void {
                connectPair(sourceNodeId, targetNodeId);
            },
            connectMany(sourceNodeIds: Iterable<number>, targetNodeIds: Iterable<number>): void {
                const targetList = [...targetNodeIds];
                for (const sourceNodeId of sourceNodeIds) {
                    for (const targetNodeId of targetList) {
                        connectPair(sourceNodeId, targetNodeId);
                    }
                }
            },
            connectInvokeArgToCallbackParam(
                call: ModuleScannedInvoke,
                sourceArgIndex: number,
                callbackArgIndex: number,
                paramIndex: number,
                options = {},
            ): number {
                const sourceNodeIds = resolveInvokeSourceNodeIds(
                    call,
                    sourceArgIndex,
                    options.sourceKind || "node",
                );
                const targetNodeIds = call.callbackParamNodeIds(
                    callbackArgIndex,
                    paramIndex,
                    { maxCandidates: options.maxCandidates },
                );
                let added = 0;
                for (const sourceNodeId of sourceNodeIds) {
                    for (const targetNodeId of targetNodeIds) {
                        if (connectPair(sourceNodeId, targetNodeId)) {
                            added++;
                        }
                    }
                }
                return added;
            },
            emit(event: ModuleFactEvent, reason: string, options = {}): ModuleEmission[] | undefined {
                const targets = targetsBySourceNodeId.get(event.current.nodeId);
                if (!targets || targets.size === 0) return undefined;
                return event.emit.toNodes(targets, reason, options);
            },
            emitPreserve(event: ModuleFactEvent, reason: string, options = {}): ModuleEmission[] | undefined {
                const targets = targetsBySourceNodeId.get(event.current.nodeId);
                if (!targets || targets.size === 0) return undefined;
                return event.emit.preserveToNodes(targets, reason, options);
            },
            emitCurrentFieldTail(event: ModuleFactEvent, reason: string, options = {}): ModuleEmission[] | undefined {
                const targets = targetsBySourceNodeId.get(event.current.nodeId);
                if (!targets || targets.size === 0) return undefined;
                return event.emit.toCurrentFieldTailNodes(targets, reason, options);
            },
            emitLoadLike(event: ModuleFactEvent, reason: string, options = {}): ModuleEmission[] | undefined {
                const targets = targetsBySourceNodeId.get(event.current.nodeId);
                if (!targets || targets.size === 0) return undefined;
                return event.emit.loadLikeToNodes(targets, reason, event.current.cloneField(), options);
            },
            emitLoadLikeCurrentFieldTail(event: ModuleFactEvent, reason: string, options = {}): ModuleEmission[] | undefined {
                const targets = targetsBySourceNodeId.get(event.current.nodeId);
                if (!targets || targets.size === 0) return undefined;
                return event.emit.loadLikeCurrentFieldTailToNodes(targets, reason, options);
            },
        };
    };

    return {
        nodeRelay(): ModuleNodeRelay {
            return createNodeRelayImpl();
        },
        keyedNodeRelay(): ModuleKeyedNodeRelay {
            const relay = createNodeRelayImpl();
            const sourceNodeIdsByKey = new Map<string, Set<number>>();
            const targetNodeIdsByKey = new Map<string, Set<number>>();
            const materializedEdges = new Set<string>();
            const ensureSourceSet = (key: string): Set<number> => {
                let nodeIds = sourceNodeIdsByKey.get(key);
                if (!nodeIds) {
                    nodeIds = new Set<number>();
                    sourceNodeIdsByKey.set(key, nodeIds);
                }
                return nodeIds;
            };
            const ensureTargetSet = (key: string): Set<number> => {
                let nodeIds = targetNodeIdsByKey.get(key);
                if (!nodeIds) {
                    nodeIds = new Set<number>();
                    targetNodeIdsByKey.set(key, nodeIds);
                }
                return nodeIds;
            };
            return {
                addSource(key: string, sourceNodeId: number): void {
                    ensureSourceSet(key).add(sourceNodeId);
                },
                addSources(key: string, sourceNodeIds: Iterable<number>): void {
                    const sources = ensureSourceSet(key);
                    for (const sourceNodeId of sourceNodeIds) {
                        sources.add(sourceNodeId);
                    }
                },
                addTarget(key: string, targetNodeId: number): void {
                    ensureTargetSet(key).add(targetNodeId);
                },
                addTargets(key: string, targetNodeIds: Iterable<number>): void {
                    const targets = ensureTargetSet(key);
                    for (const targetNodeId of targetNodeIds) {
                        targets.add(targetNodeId);
                    }
                },
                materialize(): number {
                    let added = 0;
                    for (const [key, sourceNodeIds] of sourceNodeIdsByKey.entries()) {
                        const targetNodeIds = targetNodeIdsByKey.get(key);
                        if (!targetNodeIds || targetNodeIds.size === 0) continue;
                        for (const sourceNodeId of sourceNodeIds) {
                            for (const targetNodeId of targetNodeIds) {
                                const edgeKey = `${key}:${sourceNodeId}->${targetNodeId}`;
                                if (materializedEdges.has(edgeKey)) continue;
                                materializedEdges.add(edgeKey);
                                relay.connect(sourceNodeId, targetNodeId);
                                added++;
                            }
                        }
                    }
                    return added;
                },
                emit(event: ModuleFactEvent, reason: string, options = {}): ModuleEmission[] | undefined {
                    return relay.emit(event, reason, options);
                },
                emitPreserve(event: ModuleFactEvent, reason: string, options = {}): ModuleEmission[] | undefined {
                    return relay.emitPreserve(event, reason, options);
                },
                emitCurrentFieldTail(event: ModuleFactEvent, reason: string, options = {}): ModuleEmission[] | undefined {
                    return relay.emitCurrentFieldTail(event, reason, options);
                },
                emitLoadLike(event: ModuleFactEvent, reason: string, options = {}): ModuleEmission[] | undefined {
                    return relay.emitLoadLike(event, reason, options);
                },
                emitLoadLikeCurrentFieldTail(event: ModuleFactEvent, reason: string, options = {}): ModuleEmission[] | undefined {
                    return relay.emitLoadLikeCurrentFieldTail(event, reason, options);
                },
            };
        },
        fieldRelay(): ModuleFieldRelay {
            const fieldTargetsBySourceFieldKey = new Map<string, Array<{
                sourceFieldPath: string[];
                targetNodeId: number;
                targetFieldPath: string[];
            }>>();
            const loadTargetsBySourceFieldKey = new Map<string, Array<{
                sourceFieldPath: string[];
                targetNodeId: number;
            }>>();
            const fieldDedup = new Set<string>();
            const normalizeFieldPathPrefix = (value: string | string[]): string[] => {
                const normalized = normalizeFieldPathInput(value);
                if (normalized.length === 0) {
                    throw new ModuleRuntimeDiagnosticError(
                        "module field relay sourceFieldPath must be non-empty",
                        "MODULE_INVALID_FIELD_RELAY_PATH",
                        "Provide a non-empty sourceFieldPath when connecting field relay prefixes.",
                    );
                }
                return normalized;
            };
            const ensureFieldTargetList = (sourceFieldPath: string[], sourceNodeId: number) => {
                const key = `${sourceNodeId}#${sourceFieldPath[0]}`;
                let items = fieldTargetsBySourceFieldKey.get(key);
                if (!items) {
                    items = [];
                    fieldTargetsBySourceFieldKey.set(key, items);
                }
                return { key, items };
            };
            const ensureLoadTargetList = (sourceFieldPath: string[], sourceNodeId: number) => {
                const key = `${sourceNodeId}#${sourceFieldPath[0]}`;
                let items = loadTargetsBySourceFieldKey.get(key);
                if (!items) {
                    items = [];
                    loadTargetsBySourceFieldKey.set(key, items);
                }
                return { key, items };
            };
            const startsWithFieldPath = (fieldPath: string[], prefix: string[]): boolean => {
                if (fieldPath.length < prefix.length) return false;
                for (let i = 0; i < prefix.length; i++) {
                    if (fieldPath[i] !== prefix[i]) return false;
                }
                return true;
            };
            return {
                connectField(sourceNodeId, sourceFieldName, targetNodeId, fieldPath): void {
                    this.connectFieldPath(sourceNodeId, [sourceFieldName], targetNodeId, fieldPath);
                },
                connectFields(sourceNodeIds, sourceFieldName, targetNodeIds, fieldPath): void {
                    this.connectFieldPaths(sourceNodeIds, [sourceFieldName], targetNodeIds, fieldPath);
                },
                connectFieldPath(sourceNodeId, sourceFieldPath, targetNodeId, targetFieldPath): void {
                    const normalizedSourceFieldPath = normalizeFieldPathPrefix(sourceFieldPath);
                    const normalizedTargetFieldPath = normalizeFieldPathInput(targetFieldPath);
                    const { key, items } = ensureFieldTargetList(normalizedSourceFieldPath, sourceNodeId);
                    const dedupKey = `${key}:${normalizedSourceFieldPath.join(".")}->${targetNodeId}#${normalizedTargetFieldPath.join(".")}`;
                    if (fieldDedup.has(dedupKey)) return;
                    fieldDedup.add(dedupKey);
                    items.push({
                        sourceFieldPath: normalizedSourceFieldPath,
                        targetNodeId,
                        targetFieldPath: normalizedTargetFieldPath,
                    });
                },
                connectFieldPaths(sourceNodeIds, sourceFieldPath, targetNodeIds, targetFieldPath): void {
                    const targetList = [...targetNodeIds];
                    for (const sourceNodeId of sourceNodeIds) {
                        for (const targetNodeId of targetList) {
                            this.connectFieldPath(sourceNodeId, sourceFieldPath, targetNodeId, targetFieldPath);
                        }
                    }
                },
                connectLoadCurrentFieldTail(sourceNodeId, sourceFieldName, targetNodeId): void {
                    this.connectLoadFieldTail(sourceNodeId, [sourceFieldName], targetNodeId);
                },
                connectLoadCurrentFieldTails(sourceNodeIds, sourceFieldName, targetNodeIds): void {
                    this.connectLoadFieldTails(sourceNodeIds, [sourceFieldName], targetNodeIds);
                },
                connectLoadFieldTail(sourceNodeId, sourceFieldPath, targetNodeId): void {
                    const normalizedSourceFieldPath = normalizeFieldPathPrefix(sourceFieldPath);
                    const { key, items } = ensureLoadTargetList(normalizedSourceFieldPath, sourceNodeId);
                    const dedupKey = `${key}:${normalizedSourceFieldPath.join(".")}=>${targetNodeId}`;
                    if (fieldDedup.has(dedupKey)) return;
                    fieldDedup.add(dedupKey);
                    items.push({
                        sourceFieldPath: normalizedSourceFieldPath,
                        targetNodeId,
                    });
                },
                connectLoadFieldTails(sourceNodeIds, sourceFieldPath, targetNodeIds): void {
                    const targetList = [...targetNodeIds];
                    for (const sourceNodeId of sourceNodeIds) {
                        for (const targetNodeId of targetList) {
                            this.connectLoadFieldTail(sourceNodeId, sourceFieldPath, targetNodeId);
                        }
                    }
                },
                emit(event, fieldReason, loadReason = fieldReason, options = {}): ModuleEmission[] | undefined {
                    const currentFieldPath = event.current.cloneField();
                    const fieldHead = currentFieldPath?.[0];
                    if (!fieldHead || !currentFieldPath) return undefined;
                    const key = `${event.current.nodeId}#${fieldHead}`;
                    const collector = event.emit.collector();
                    const fieldTargets = fieldTargetsBySourceFieldKey.get(key) || [];
                    for (const target of fieldTargets) {
                        if (!startsWithFieldPath(currentFieldPath, target.sourceFieldPath)) continue;
                        const fieldTail = currentFieldPath.slice(target.sourceFieldPath.length);
                        const targetFieldPath = fieldTail.length > 0
                            ? [...target.targetFieldPath, ...fieldTail]
                            : [...target.targetFieldPath];
                        collector.push(event.emit.toField(target.targetNodeId, targetFieldPath, fieldReason, options));
                    }
                    const loadTargets = loadTargetsBySourceFieldKey.get(key);
                    if (loadTargets && loadTargets.length > 0) {
                        for (const target of loadTargets) {
                            if (!startsWithFieldPath(currentFieldPath, target.sourceFieldPath)) continue;
                            const fieldTail = currentFieldPath.slice(target.sourceFieldPath.length);
                            collector.push(event.emit.loadLikeToNode(
                                target.targetNodeId,
                                loadReason,
                                fieldTail.length > 0 ? fieldTail : undefined,
                                options,
                            ));
                        }
                    }
                    return collector.done();
                },
            };
        },
    };
}

function collectCallbackMethodsWithQueries(
    scene: any,
    queries: InternalModuleQueryApi,
    callbackValue: any,
    options: ModuleCallbackResolveOptions = {},
): ModuleResolvedCallbackMethod[] {
    if (!scene) {
        return [];
    }
    const methods = new Map<string, any>();
    const addMethod = (method: any): void => {
        const meta = resolveMethodMeta(method);
        if (!meta.ownerMethodSignature) return;
        if (methods.has(meta.ownerMethodSignature)) return;
        methods.set(meta.ownerMethodSignature, method);
    };

    for (const method of resolveCallbackMethodsFromValueWithReturns(
        scene,
        callbackValue,
        { maxDepth: options.maxCandidates ?? 4 },
    )) {
        addMethod(method);
    }

    for (const method of queries.resolveMethodsFromCallable(scene, callbackValue, {
        maxCandidates: options.maxCandidates,
        enableLocalBacktrace: true,
        maxBacktraceSteps: 5,
        maxVisitedDefs: 16,
    })) {
        addMethod(method);
    }

    const rawName = String(callbackValue?.getName?.() || callbackValue?.toString?.() || "").trim();
    if (rawName.startsWith("%AM")) {
        for (const method of scene.getMethods?.() || []) {
            if (method.getName?.() === rawName && method.getCfg?.()) {
                addMethod(method);
            }
        }
    }

    const methodSigText = callbackValue?.getType?.()?.getMethodSignature?.()?.toString?.() || "";
    if (methodSigText) {
        const matched = getMethodBySignature(scene, methodSigText);
        if (matched?.getCfg?.()) {
            addMethod(matched);
        }
    }

    for (const hint of collectCallableNameHints(rawName, methodSigText)) {
        for (const method of scene.getMethods?.() || []) {
            if (method.getName?.() === hint && method.getCfg?.()) {
                addMethod(method);
            }
        }
    }

    const out: ModuleResolvedCallbackMethod[] = [];
    for (const method of methods.values()) {
        const meta = resolveMethodMeta(method);
        out.push({
            method,
            methodSignature: meta.ownerMethodSignature,
            methodName: meta.ownerMethodName,
            declaringClassName: meta.declaringClassName,
        });
    }
    return out;
}

function resolveDeferredBindingMethod(
    scene: any,
    source: any,
): any | undefined {
    if (!source) return undefined;
    if (typeof source?.getSignature === "function") {
        return source;
    }
    const signature = String(source || "").trim();
    if (!signature) return undefined;
    return getMethodBySignature(scene, signature);
}

function resolveDeferredBindingMethods(
    scene: any,
    methods?: any[],
    signatures?: string[],
): any[] {
    const out: any[] = [];
    const seen = new Set<string>();
    const add = (method: any): void => {
        const resolved = resolveDeferredBindingMethod(scene, method);
        if (!resolved?.getCfg?.()) return;
        const signature = resolved.getSignature?.()?.toString?.() || "";
        if (!signature || seen.has(signature)) return;
        seen.add(signature);
        out.push(resolved);
    };
    for (const method of methods || []) {
        add(method);
    }
    for (const signature of signatures || []) {
        add(signature);
    }
    return out;
}

function normalizeExplicitDeferredBindingSemantics(
    semantics?: {
        activation?: ModuleExplicitDeferredBindingRecord["semantics"]["activation"];
        completion?: ModuleExplicitDeferredBindingRecord["semantics"]["completion"];
        preserve?: ModuleExplicitDeferredBindingRecord["semantics"]["preserve"];
        continuationRole?: ModuleExplicitDeferredBindingRecord["semantics"]["continuationRole"];
    },
): ModuleExplicitDeferredBindingRecord["semantics"] {
    return {
        activation: semantics?.activation || "event(c)",
        completion: semantics?.completion || "none",
        preserve: [...(semantics?.preserve || [])],
        continuationRole: semantics?.continuationRole || "none",
    };
}

function createDeferredBindingApi(
    raw: InternalRawModuleSetupContext,
    moduleId: string,
    collector?: DeferredBindingCollector,
): ModuleDeferredBindingApi {
    const assertSetupPhase = (): DeferredBindingCollector => {
        if (collector) {
            return collector;
        }
        throw new ModuleRuntimeDiagnosticError(
            `module ${moduleId} attempted to declare deferred bindings outside setup`,
            "MODULE_DEFERRED_BINDING_OUTSIDE_SETUP",
            "Declare deferred bindings only from module.setup(ctx). Runtime hooks must emit taint facts, not mutate the deferred binding model.",
        );
    };

    return {
        imperativeFromInvoke(invoke, callbackArgIndex, options = {}) {
            const bindingCollector = assertSetupPhase();
            const sourceMethod = getMethodBySignature(raw.scene, invoke.ownerMethodSignature)
                || invoke.stmt?.getCfg?.()?.getDeclaringMethod?.();
            if (!sourceMethod?.getCfg?.()) {
                throw new ModuleRuntimeDiagnosticError(
                    `module ${moduleId} declared an imperative deferred binding without a resolvable source method`,
                    "MODULE_INVALID_DEFERRED_BINDING",
                    "Use a scanned invoke that belongs to a concrete source method. The module runtime could not resolve invoke.ownerMethodSignature back to a method body.",
                );
            }
            const callbackValue = invoke.arg(callbackArgIndex);
            const callbackMethods = collectCallbackMethodsWithQueries(
                raw.scene,
                raw.queries,
                callbackValue,
                { maxCandidates: options.maxCandidates },
            );
            if (callbackMethods.length === 0) {
                return 0;
            }

            let added = 0;
            for (const resolved of callbackMethods) {
                const unit = resolved.method;
                if (!unit?.getCfg?.()) continue;
                const binding: ModuleExplicitImperativeDeferredBindingRecord = {
                    moduleId,
                    bindingKind: "imperative",
                    sourceMethod,
                    unit,
                    anchorStmt: invoke.stmt,
                    carrierKind: options.carrierKind || "direct",
                    reason: options.reason
                        || `Module ${moduleId} declared an imperative deferred binding from ${invoke.call.signature}`,
                    semantics: normalizeExplicitDeferredBindingSemantics(options.semantics),
                    invokeText: invoke.stmt?.toString?.() || invoke.call.signature,
                };
                bindingCollector.add(binding);
                added += 1;
            }
            return added;
        },
        declarative(declaration: ModuleDeclarativeDeferredBindingDeclaration): void {
            const bindingCollector = assertSetupPhase();
            const sourceMethod = resolveDeferredBindingMethod(
                raw.scene,
                declaration.sourceMethod || declaration.sourceMethodSignature,
            );
            const handlerMethod = resolveDeferredBindingMethod(
                raw.scene,
                declaration.handlerMethod || declaration.handlerMethodSignature,
            );
            const envSourceMethods = resolveDeferredBindingMethods(
                raw.scene,
                declaration.envSourceMethods,
                declaration.envSourceMethodSignatures,
            );
            if (!sourceMethod?.getCfg?.() || !handlerMethod?.getCfg?.()) {
                throw new ModuleRuntimeDiagnosticError(
                    `module ${moduleId} declared a declarative deferred binding with unresolved source or handler method`,
                    "MODULE_INVALID_DEFERRED_BINDING",
                    "Provide a concrete source method and handler method, either as method objects or exact method signatures, when declaring a deferred binding.",
                );
            }
            if (!declaration.anchorStmt) {
                throw new ModuleRuntimeDiagnosticError(
                    `module ${moduleId} declared a declarative deferred binding without an anchor statement`,
                    "MODULE_INVALID_DEFERRED_BINDING",
                    "Declarative deferred bindings require an anchorStmt so the engine can attach the binding to a stable site key.",
                );
            }
            const binding: ModuleExplicitDeclarativeDeferredBindingRecord = {
                moduleId,
                bindingKind: "declarative",
                sourceMethod,
                unit: handlerMethod,
                anchorStmt: declaration.anchorStmt,
                carrierKind: declaration.carrierKind || "field",
                triggerLabel: declaration.triggerLabel,
                envSourceMethods,
                reason: declaration.reason
                    || `Module ${moduleId} declared a declarative deferred binding for ${declaration.triggerLabel}`,
                semantics: normalizeExplicitDeferredBindingSemantics(declaration.semantics),
                activationSource: declaration.activationSource,
                payloadSource: declaration.payloadSource,
            };
            bindingCollector.add(binding);
        },
    };
}

function collectCallableNameHints(...texts: string[]): string[] {
    const out = new Set<string>();
    const add = (name: string): void => {
        const normalized = String(name || "").trim().replace(/^['"`]|['"`]$/g, "");
        if (!normalized) return;
        if (normalized.includes("(")) return;
        out.add(normalized);
        if (normalized.includes(".")) {
            const tail = normalized.split(".").pop() || "";
            if (tail) out.add(tail);
        }
    };

    for (const text of texts) {
        const raw = String(text || "").trim();
        if (!raw) continue;
        add(raw);

        const callableToken = raw.match(/([A-Za-z_$%][A-Za-z0-9_$%]*)\s*(?:\(|$)/);
        if (callableToken?.[1]) {
            add(callableToken[1]);
        }

        const signatureName = raw.match(/\.([A-Za-z_$%][A-Za-z0-9_$%]*)\s*\(/);
        if (signatureName?.[1]) {
            add(signatureName[1]);
        }
    }

    return [...out];
}

function collectCallbackParamBindingsWithQueries(
    scene: any,
    pag: any,
    queries: InternalModuleQueryApi,
    callbackValue: any,
    paramIndex: number,
    options: ModuleCallbackResolveOptions = {},
): ModuleResolvedCallbackParamBinding[] {
    const callbackMethods = collectCallbackMethodsWithQueries(scene, queries, callbackValue, options);
    const out: ModuleResolvedCallbackParamBinding[] = [];
    const seen = new Set<string>();
    for (const callbackMethod of callbackMethods) {
        const paramAssignStmts = queries.collectParameterAssignStmts(callbackMethod.method)
            .filter(stmt => (stmt.getRightOp?.() as ArkParameterRef | undefined)?.getIndex?.() === paramIndex);
        for (const paramStmt of paramAssignStmts) {
            const left = paramStmt.getLeftOp?.();
            const localName = resolveLocalName(left);
            const key = `${callbackMethod.methodSignature}|${paramIndex}|${localName || ""}|${String(paramStmt)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({
                ...callbackMethod,
                stmt: paramStmt,
                paramIndex,
                local(): any | undefined {
                    return left;
                },
                localName(): string | undefined {
                    return localName;
                },
                localNodeIds(): number[] {
                    if (!pag) return [];
                    const nodes = pag.getNodesByValue(left);
                    return nodes ? [...nodes.values()] : [];
                },
                localUseNodeIds(): number[] {
                    return collectExactLocalUseNodeIds(pag, callbackMethod.method, left, paramStmt);
                },
                localObjectNodeIds(): number[] {
                    if (!pag) return [];
                    return [...collectObjectNodeIdsFromValue(pag, left).values()];
                },
                localCarrierNodeIds(): number[] {
                    const localNodeIds = this.localNodeIds();
                    const localObjectNodeIds = this.localObjectNodeIds();
                    return [...new Set<number>([...localNodeIds, ...localObjectNodeIds])];
                },
            });
        }
    }
    return out;
}

function collectExactLocalUseNodeIds(pag: any, method: any, local: any, definingStmt?: any): number[] {
    if (!pag || !method?.getCfg?.() || !local) return [];
    const out = new Set<number>();
    const addNodes = (value: any, anchorStmt?: any): void => {
        const effectiveNodes = value && anchorStmt && shouldMaterializeExactModuleUseEndpoint(value)
            ? materializeExactPagNodes(pag, value, anchorStmt, 0)
            : value
                ? pag.getNodesByValue(value)
                : undefined;
        if (!effectiveNodes || effectiveNodes.size === 0) return;
        for (const nodeId of effectiveNodes.values()) {
            out.add(nodeId);
        }
    };

    for (const stmt of method.getCfg().getStmts()) {
        if (stmt === definingStmt) continue;
        if (isAssignStmtLike(stmt)) {
            const left = stmt.getLeftOp();
            const right = stmt.getRightOp();
            if (isSameLocalValue(right, local)) {
                addNodes(left, stmt);
                continue;
            }
            if (isFieldRefLike(left) && isSameLocalValue(left.getBase?.(), local)) {
                addNodes(left, stmt);
            }
            if (isFieldRefLike(right) && isSameLocalValue(right.getBase?.(), local)) {
                addNodes(right, stmt);
            }
        }
        if (!stmt.containsInvokeExpr?.()) continue;
        const invokeExpr = stmt.getInvokeExpr?.();
        if (!invokeExpr) continue;
        if (isInstanceInvokeExprLike(invokeExpr) && isSameLocalValue(invokeExpr.getBase?.(), local)) {
            addNodes(invokeExpr.getBase?.(), stmt);
        }
        for (const arg of invokeExpr.getArgs?.() || []) {
            if (isSameLocalValue(arg, local)) {
                addNodes(arg, stmt);
            }
            if (isFieldRefLike(arg) && isSameLocalValue(arg.getBase?.(), local)) {
                addNodes(arg, stmt);
            }
        }
    }
    return [...out.values()];
}

function shouldMaterializeExactModuleUseEndpoint(value: any): boolean {
    const name = resolveLocalName(value);
    if (name) {
        return name !== "this" && !name.startsWith("%");
    }
    if (!isFieldRefLike(value)) {
        return false;
    }
    const baseName = resolveLocalName(value.getBase?.());
    return !!baseName && baseName !== "this" && !baseName.startsWith("%");
}

function shouldMaterializeExactModuleEndpointValue(value: any): boolean {
    const name = resolveLocalName(value);
    if (name) {
        return name !== "this";
    }
    if (!isFieldRefLike(value)) {
        return false;
    }
    const baseName = resolveLocalName(value.getBase?.());
    return !!baseName && baseName !== "this";
}

function shouldMaterializeExactModuleResultEndpoint(value: any): boolean {
    const name = resolveLocalName(value);
    if (name) {
        return name !== "this";
    }
    return shouldMaterializeExactModuleUseEndpoint(value);
}

function collectCallbackParamNodeIdsWithQueries(
    scene: any,
    pag: any,
    queries: InternalModuleQueryApi,
    callbackValue: any,
    paramIndex: number,
    options: ModuleCallbackResolveOptions = {},
): number[] {
    const out = new Set<number>();
    for (const binding of collectCallbackParamBindingsWithQueries(scene, pag, queries, callbackValue, paramIndex, options)) {
        for (const nodeId of binding.localNodeIds()) {
            out.add(nodeId);
        }
        for (const nodeId of binding.localUseNodeIds()) {
            out.add(nodeId);
        }
    }
    return [...out.values()];
}

function createSetupCallbackApi(raw: InternalRawModuleSetupContext): ModuleSetupCallbackApi {
    return {
        methods(callbackValue: any, options = {}): ModuleResolvedCallbackMethod[] {
            return collectCallbackMethodsWithQueries(raw.scene, raw.queries, callbackValue, options);
        },
        paramBindings(callbackValue: any, paramIndex: number, options = {}): ModuleResolvedCallbackParamBinding[] {
            return collectCallbackParamBindingsWithQueries(
                raw.scene,
                raw.pag,
                raw.queries,
                callbackValue,
                paramIndex,
                options,
            );
        },
        paramNodeIds(callbackValue: any, paramIndex: number, options = {}): number[] {
            if (!raw.scene || !raw.pag) {
                return [];
            }
            return collectCallbackParamNodeIdsWithQueries(
                raw.scene,
                raw.pag,
                raw.queries,
                callbackValue,
                paramIndex,
                options,
            );
        },
    };
}

function toPublicRawSetupContext(raw: InternalRawModuleSetupContext): RawModuleSetupContext {
    return {
        scene: raw.scene,
        pag: raw.pag,
        allowedMethodSignatures: raw.allowedMethodSignatures,
        fieldToVarIndex: raw.fieldToVarIndex,
        log: raw.log,
        canonicalApiOccurrences: raw.canonicalApiOccurrences,
        canonicalDecoratorOccurrences: raw.canonicalDecoratorOccurrences,
    };
}

function toPublicRawFactEvent(raw: InternalRawModuleFactEvent) {
    return {
        ...toPublicRawSetupContext(raw),
        fact: raw.fact,
        node: raw.node,
    };
}

function toPublicRawInvokeEvent(raw: InternalRawModuleInvokeEvent) {
    return {
        ...toPublicRawFactEvent(raw),
        stmt: raw.stmt,
        invokeExpr: raw.invokeExpr,
        callSignature: raw.callSignature,
        methodName: raw.methodName,
        declaringClassName: raw.declaringClassName,
        canonicalApiId: raw.canonicalApiId,
        occurrenceId: raw.occurrenceId,
        rawOccurrenceId: raw.rawOccurrenceId,
        semanticEffectSites: [...raw.semanticEffectSites],
        args: raw.args,
        baseValue: raw.baseValue,
        resultValue: raw.resultValue,
    };
}

function createSetupContext(
    raw: InternalRawModuleSetupContext,
    options: {
        moduleId?: string;
        deferredBindings?: DeferredBindingCollector;
    } = {},
): ModuleSetupContext {
    const analysis = createAnalysisApi(raw);
    return {
        raw: toPublicRawSetupContext(raw),
        methods: createMethodsApi(raw),
        scan: createScanApi(raw),
        bridge: createBridgeApi(),
        deferred: createDeferredBindingApi(raw, options.moduleId || "<unknown-module>", options.deferredBindings),
        callbacks: createSetupCallbackApi(raw),
        analysis,
        log: raw.log,
        debug: buildSetupDebugApi(raw.log, (raw as any).__moduleAuditEntry as ModuleAuditEntry | undefined),
    };
}

function createCurrentFactView(event: InternalRawModuleFactEvent): ModuleCurrentFactView {
    return {
        nodeId: event.node.getID(),
        source: event.fact.source,
        contextId: event.fact.contextID,
        field: cloneFieldPath(event.fact.field),
        value: event.node.getValue?.(),
        hasField(): boolean {
            return !!event.fact.field && event.fact.field.length > 0;
        },
        fieldHead(): string | undefined {
            return event.fact.field?.[0];
        },
        fieldTail(): string[] | undefined {
            return event.fact.field && event.fact.field.length > 1
                ? event.fact.field.slice(1)
                : undefined;
        },
        cloneField(): string[] | undefined {
            return cloneFieldPath(event.fact.field);
        },
    };
}

function createCurrentNodeView(event: InternalRawModuleCopyEdgeEvent): ModuleCurrentNodeView {
    return {
        nodeId: event.node.getID(),
        contextId: event.contextId,
        value: event.node.getValue?.(),
    };
}

function createEmitApi(
    event: InternalRawModuleFactEvent,
): ModuleEmitApi {
    const buildEmission = (
        reason: string,
        fact: TaintFact,
        options?: {
            chain?: ModuleEmission["chain"];
            allowUnreachableTarget?: boolean;
        },
    ): ModuleEmission => ({
        reason,
        fact,
        chain: options?.chain,
        allowUnreachableTarget: options?.allowUnreachableTarget,
    });

    const createCollector = (): ModuleEmitCollector => {
        const items: ModuleEmission[] = [];
        const dedup = new Set<string>();
        return {
            push(nextItems?: ModuleEmission[] | void): void {
                if (!nextItems || nextItems.length === 0) return;
                for (const item of nextItems) {
                    const key = `${item.reason}|${item.fact.id}`;
                    if (dedup.has(key)) continue;
                    dedup.add(key);
                    items.push(item);
                }
            },
            size(): number {
                return items.length;
            },
            done(): ModuleEmission[] | undefined {
                return items.length > 0 ? items : undefined;
            },
        };
    };

    const emitToNode = (
        target: number | PagNode | null | undefined,
        reason: string,
        options: ModuleEmitOptions,
        mode: EmitFieldMode,
        explicitField?: string[],
    ): ModuleEmission[] => {
        const node = resolveTargetNode(event, target);
        if (!node) return [];
        return [buildEmission(
            reason,
            new TaintFact(
                node,
                options.source ?? event.fact.source,
                options.contextId ?? event.fact.contextID,
                resolveEmitFieldPath(event, mode, explicitField),
            ),
            options,
        )];
    };

    const emitToNodes = (
        targets: Iterable<number | PagNode>,
        reason: string,
        options: ModuleEmitOptions,
        mode: EmitFieldMode,
        explicitField?: string[],
    ): ModuleEmission[] => {
        const out: ModuleEmission[] = [];
        const dedup = new Set<string>();
        const fieldPath = resolveEmitFieldPath(event, mode, explicitField);
        for (const target of targets) {
            const node = resolveTargetNode(event, target);
            if (!node) continue;
            const fact = new TaintFact(
                node,
                options.source ?? event.fact.source,
                options.contextId ?? event.fact.contextID,
                fieldPath ? [...fieldPath] : undefined,
            );
            const dedupKey = `${reason}|${fact.id}`;
            if (dedup.has(dedupKey)) continue;
            dedup.add(dedupKey);
            out.push(buildEmission(reason, fact, options));
        }
        return out;
    };

    const normalizeFieldPath = (fieldPath: string | string[]): string[] =>
        Array.isArray(fieldPath) ? [...fieldPath] : [fieldPath];

    const resolveValueTargetNodeIds = (
        targetValue: any,
        options?: ModuleValueEmitOptions,
    ): number[] => {
        const objectNodeIds = [...collectObjectNodeIdsFromValue(event.pag, targetValue).values()];
        if (objectNodeIds.length > 0) {
            return objectNodeIds;
        }
        const directNodeIds = collectNodeIdsFromValue(event.pag, targetValue);
        if (directNodeIds.size > 0) {
            return [...directNodeIds.values()];
        }
        return [];
    };

    const emitLoadLikeToNodes = (
        targets: Iterable<number | PagNode>,
        reason: string,
        fieldPath: string[] | undefined,
        options: ModuleEmitOptions,
    ): ModuleEmission[] => {
        const out: ModuleEmission[] = [];
        const dedup = new Set<string>();
        const hasField = !!fieldPath && fieldPath.length > 0;
        for (const target of targets) {
            const node = resolveTargetNode(event, target);
            if (!node) continue;
            if (!hasField) {
                const fact = new TaintFact(
                    node,
                    options.source ?? event.fact.source,
                    options.contextId ?? event.fact.contextID,
                );
                const dedupKey = `${reason}|${fact.id}`;
                if (dedup.has(dedupKey)) continue;
                dedup.add(dedupKey);
                out.push(buildEmission(reason, fact, options));
                continue;
            }

            let emittedObjectField = false;
            for (const objectNodeId of node.getPointTo()) {
                const objectNode = event.pag.getNode(objectNodeId) as PagNode | undefined;
                if (!objectNode) continue;
                emittedObjectField = true;
                const fact = new TaintFact(
                    objectNode,
                    options.source ?? event.fact.source,
                    options.contextId ?? event.fact.contextID,
                    [...fieldPath],
                );
                const dedupKey = `${reason}|${fact.id}`;
                if (dedup.has(dedupKey)) continue;
                dedup.add(dedupKey);
                out.push(buildEmission(reason, fact, options));
            }
            if (!emittedObjectField) {
                const fact = new TaintFact(
                    node,
                    options.source ?? event.fact.source,
                    options.contextId ?? event.fact.contextID,
                    [...fieldPath],
                );
                const dedupKey = `${reason}|${fact.id}`;
                if (dedup.has(dedupKey)) continue;
                dedup.add(dedupKey);
                out.push(buildEmission(reason, fact, options));
            }
        }
        return out;
    };

    return {
        toNode(target: number | PagNode | null | undefined, reason: string, options = {}): ModuleEmission[] {
            return emitToNode(target, reason, options, "generic");
        },

        toNodes(targets: Iterable<number | PagNode>, reason: string, options = {}): ModuleEmission[] {
            return emitToNodes(targets, reason, options, "generic");
        },

        preserveToNode(target: number | PagNode | null | undefined, reason: string, options = {}): ModuleEmission[] {
            return emitToNode(target, reason, options, "preserve_current");
        },

        preserveToNodes(targets: Iterable<number | PagNode>, reason: string, options = {}): ModuleEmission[] {
            return emitToNodes(targets, reason, options, "preserve_current");
        },

        toCurrentFieldTailNode(target: number | PagNode | null | undefined, reason: string, options = {}): ModuleEmission[] {
            return emitToNode(target, reason, options, "current_field_tail");
        },

        toCurrentFieldTailNodes(targets: Iterable<number | PagNode>, reason: string, options = {}): ModuleEmission[] {
            return emitToNodes(targets, reason, options, "current_field_tail");
        },

        toField(target: number | PagNode | null | undefined, fieldPath: string | string[], reason: string, options = {}): ModuleEmission[] {
            const node = resolveTargetNode(event, target);
            if (!node) return [];
            const normalizedFieldPath = normalizeFieldPath(fieldPath);
            return emitToNode(node, reason, options, "explicit", normalizedFieldPath);
        },

        toFields(targets: Iterable<number | PagNode>, fieldPath: string | string[], reason: string, options = {}): ModuleEmission[] {
            const normalizedFieldPath = normalizeFieldPath(fieldPath);
            return emitToNodes(targets, reason, options, "explicit", normalizedFieldPath);
        },

        toValueField(targetValue: any, fieldPath: string | string[], reason: string, options = {}): ModuleEmission[] {
            const normalizedFieldPath = normalizeFieldPath(fieldPath);
            return emitToNodes(
                resolveValueTargetNodeIds(targetValue, options),
                reason,
                options,
                "explicit",
                normalizedFieldPath,
            );
        },

        loadLikeToNode(target: number | PagNode | null | undefined, reason: string, fieldPath, options = {}): ModuleEmission[] {
            return emitLoadLikeToNodes([target], reason, cloneFieldPath(fieldPath), options);
        },

        loadLikeToNodes(targets: Iterable<number | PagNode>, reason: string, fieldPath, options = {}): ModuleEmission[] {
            return emitLoadLikeToNodes(targets, reason, cloneFieldPath(fieldPath), options);
        },

        loadLikeCurrentFieldTailToNode(target: number | PagNode | null | undefined, reason: string, options = {}): ModuleEmission[] {
            const fieldPath = event.fact.field && event.fact.field.length > 1
                ? event.fact.field.slice(1)
                : undefined;
            return emitLoadLikeToNodes([target], reason, fieldPath, options);
        },

        loadLikeCurrentFieldTailToNodes(targets: Iterable<number | PagNode>, reason: string, options = {}): ModuleEmission[] {
            const fieldPath = event.fact.field && event.fact.field.length > 1
                ? event.fact.field.slice(1)
                : undefined;
            return emitLoadLikeToNodes(targets, reason, fieldPath, options);
        },

        collector(): ModuleEmitCollector {
            return createCollector();
        },
    };
}

function createCallView(event: InternalRawModuleInvokeEvent) {
    return {
        signature: event.callSignature,
        methodName: event.methodName,
        declaringClassName: event.declaringClassName,
        argCount: event.args.length,
        canonicalApiId: event.canonicalApiId,
        occurrenceId: event.occurrenceId,
        rawOccurrenceId: event.rawOccurrenceId,
        semanticEffectSites: [...event.semanticEffectSites],
    };
}

function createValuesView(event: InternalRawModuleInvokeEvent) {
    return {
        arg(index: number): any | undefined {
            return index >= 0 && index < event.args.length ? event.args[index] : undefined;
        },
        args(): any[] {
            return [...event.args];
        },
        base(): any | undefined {
            return event.baseValue;
        },
        result(): any | undefined {
            return event.resultValue;
        },
        stringArg(index: number, maxDepth?: number): string[] {
            const value = index >= 0 && index < event.args.length ? event.args[index] : undefined;
            return event.queries.collectFiniteStringCandidatesFromValue(event.scene, value, maxDepth);
        },
        stringCandidates(value: any, maxDepth?: number): string[] {
            return event.queries.collectFiniteStringCandidatesFromValue(event.scene, value, maxDepth);
        },
    };
}

function matchesCurrentFactValue(event: InternalRawModuleInvokeEvent, value: any): boolean {
    const analysis = createAnalysisApi(event);
    const candidateNodeIds = new Set<number>([
        ...analysis.nodeIdsForValue(value, event.stmt),
        ...analysis.objectNodeIdsForValue(value),
    ]);
    return candidateNodeIds.has(event.node.getID());
}

function createInvokeMatchApi(event: InternalRawModuleInvokeEvent): ModuleInvokeMatchApi {
    return {
        value(value: any): boolean {
            return matchesCurrentFactValue(event, value);
        },
        arg(index: number): boolean {
            const value = index >= 0 && index < event.args.length ? event.args[index] : undefined;
            return matchesCurrentFactValue(event, value);
        },
        base(): boolean {
            return matchesCurrentFactValue(event, event.baseValue);
        },
        result(): boolean {
            return matchesCurrentFactValue(event, event.resultValue);
        },
    };
}

function collectCallbackParamNodeIds(
    event: InternalRawModuleInvokeEvent,
    callbackValue: any,
    paramIndex: number,
    options: ModuleCallbackResolveOptions = {},
): number[] {
    return collectCallbackParamNodeIdsWithQueries(
        event.scene,
        event.pag,
        event.queries,
        callbackValue,
        paramIndex,
        options,
    );
}

function createCallbackApi(event: InternalRawModuleInvokeEvent): ModuleCallbackApi {
    const emit = createEmitApi(event);
    return {
        methods(callbackValue: any, options = {}): ModuleResolvedCallbackMethod[] {
            return collectCallbackMethodsWithQueries(event.scene, event.queries, callbackValue, options);
        },
        paramBindings(callbackValue: any, paramIndex: number, options = {}): ModuleResolvedCallbackParamBinding[] {
            return collectCallbackParamBindingsWithQueries(
                event.scene,
                event.pag,
                event.queries,
                callbackValue,
                paramIndex,
                options,
            );
        },
        paramNodeIds(callbackValue: any, paramIndex: number, options = {}): number[] {
            return collectCallbackParamNodeIds(event, callbackValue, paramIndex, options);
        },
        toParam(callbackValue: any, paramIndex: number, reason: string, options = {}): ModuleEmission[] {
            return emit.toNodes(collectCallbackParamNodeIds(event, callbackValue, paramIndex), reason, options);
        },
        preserveToParam(callbackValue: any, paramIndex: number, reason: string, options = {}): ModuleEmission[] {
            return emit.preserveToNodes(collectCallbackParamNodeIds(event, callbackValue, paramIndex), reason, options);
        },
        toCurrentFieldTailParam(callbackValue: any, paramIndex: number, reason: string, options = {}): ModuleEmission[] {
            return emit.toCurrentFieldTailNodes(collectCallbackParamNodeIds(event, callbackValue, paramIndex), reason, options);
        },
        toFieldParam(callbackValue: any, paramIndex: number, fieldPath: string | string[], reason: string, options = {}): ModuleEmission[] {
            return emit.toFields(collectCallbackParamNodeIds(event, callbackValue, paramIndex), fieldPath, reason, options);
        },
        loadLikeToParam(callbackValue: any, paramIndex: number, reason: string, fieldPath, options = {}): ModuleEmission[] {
            return emit.loadLikeToNodes(collectCallbackParamNodeIds(event, callbackValue, paramIndex), reason, cloneFieldPath(fieldPath), options);
        },
        loadLikeCurrentFieldTailToParam(callbackValue: any, paramIndex: number, reason: string, options = {}): ModuleEmission[] {
            return emit.loadLikeCurrentFieldTailToNodes(collectCallbackParamNodeIds(event, callbackValue, paramIndex), reason, options);
        },
    };
}

function createFactEvent(
    moduleId: string,
    raw: InternalRawModuleFactEvent,
    runtimeContext?: ModuleSetupContext,
): ModuleFactEvent {
    const entry = (raw as any).__moduleAuditEntry as ModuleAuditEntry;
    return {
        ...(runtimeContext || createSetupContext(raw, { moduleId })),
        raw: toPublicRawFactEvent(raw),
        current: createCurrentFactView(raw),
        emit: createEmitApi(raw),
        debug: buildDebugApi(moduleId, entry, raw.log),
    };
}

function createInvokeEvent(
    moduleId: string,
    raw: InternalRawModuleInvokeEvent,
    runtimeContext?: ModuleSetupContext,
): ModuleInvokeEvent {
    return {
        ...createFactEvent(moduleId, raw, runtimeContext),
        raw: toPublicRawInvokeEvent(raw),
        call: createCallView(raw),
        values: createValuesView(raw),
        callbacks: createCallbackApi(raw),
        match: createInvokeMatchApi(raw),
    };
}

function createCopyEdgeEvent(moduleId: string, raw: InternalRawModuleCopyEdgeEvent): ModuleCopyEdgeEvent {
    const entry = (raw as any).__moduleAuditEntry as ModuleAuditEntry;
    return {
        raw,
        current: createCurrentNodeView(raw),
        debug: buildDebugApi(moduleId, entry, () => {}),
    };
}

function createModuleAuditEntry(moduleId: string, sourcePath?: string): ModuleAuditEntry {
    return {
        moduleId,
        sourcePath,
        factHookCalls: 0,
        invokeHookCalls: 0,
        copyEdgeChecks: 0,
        factHookMs: 0,
        invokeHookMs: 0,
        copyEdgeMs: 0,
        factEmissionCount: 0,
        invokeEmissionCount: 0,
        totalEmissionCount: 0,
        skipCopyEdgeCount: 0,
        debugHitCount: 0,
        debugSkipCount: 0,
        debugLogCount: 0,
        recentDebugMessages: [],
        emissionSamples: [],
        emissionSampleOverflowCount: 0,
    };
}

const MODULE_EMISSION_AUDIT_SAMPLE_LIMIT = 200;

function pushModuleEmissionAuditSample(
    entry: ModuleAuditEntry,
    moduleId: string,
    hook: "onFact" | "onInvoke",
    raw: InternalRawModuleFactEvent | InternalRawModuleInvokeEvent,
    emission: ModuleEmission,
): void {
    if (entry.emissionSamples.length >= MODULE_EMISSION_AUDIT_SAMPLE_LIMIT) {
        entry.emissionSampleOverflowCount += 1;
        return;
    }
    const sample: ModuleEmissionAuditEntry = {
        moduleId,
        hook,
        reason: emission.reason,
        sourceFactId: raw.fact.taintId,
        sourceNodeId: raw.node.getID(),
        sourceContextId: raw.fact.contextID,
        source: raw.fact.source,
        sourceFieldPath: raw.fact.field ? [...raw.fact.field] : undefined,
        targetFactId: emission.fact.taintId,
        targetNodeId: emission.fact.node.getID(),
        targetContextId: emission.fact.contextID,
        targetFieldPath: emission.fact.field ? [...emission.fact.field] : undefined,
        ownerMethodSignature: (raw as any).ownerMethodSignature,
        callSignature: (raw as any).callSignature,
    };
    entry.emissionSamples.push(sample);
}

class DefaultModuleRuntime implements ModuleRuntime {
    private readonly failedModuleIds = new Set<string>();
    private readonly audit: ModuleAuditSnapshot;

    constructor(
        private readonly modules: TaintModule[],
        private readonly sessions: RegisteredSession[],
        private readonly deferredBindingCollector: DeferredBindingCollector,
    ) {
        this.audit = emptyModuleAuditSnapshot();
        this.audit.loadedModuleIds = modules.map(module => module.id);
        for (const module of modules) {
            this.audit.moduleStats[module.id] = createModuleAuditEntry(
                module.id,
                getExtensionSourceModulePath(module),
            );
        }
    }

    listModuleIds(): string[] {
        return this.modules.map(module => module.id);
    }

    getAuditSnapshot(): ModuleAuditSnapshot {
        return {
            loadedModuleIds: [...this.audit.loadedModuleIds],
            failedModuleIds: [...this.audit.failedModuleIds],
            failureEvents: this.audit.failureEvents.map(event => ({ ...event })),
            moduleStats: Object.fromEntries(
                Object.entries(this.audit.moduleStats).map(([moduleId, entry]) => [
                    moduleId,
                    {
                        ...entry,
                        recentDebugMessages: [...entry.recentDebugMessages],
                        emissionSamples: entry.emissionSamples.map(sample => ({
                            ...sample,
                            sourceFieldPath: sample.sourceFieldPath ? [...sample.sourceFieldPath] : undefined,
                            targetFieldPath: sample.targetFieldPath ? [...sample.targetFieldPath] : undefined,
                        })),
                    },
                ]),
            ),
        };
    }

    getDeferredBindingDeclarations(): ModuleExplicitDeferredBindingRecord[] {
        return this.deferredBindingCollector.all();
    }

    emitForFact(event: ModuleRuntime["emitForFact"] extends (event: infer E) => any ? E : never): ModuleEmission[] {
        return this.collectEmissions("onFact", event);
    }

    emitForInvoke(event: ModuleRuntime["emitForInvoke"] extends (event: infer E) => any ? E : never): ModuleEmission[] {
        if (!hasCanonicalInvokeIdentity(event)) {
            return [];
        }
        return this.collectEmissions("onInvoke", event);
    }

    private collectEmissions(
        hook: "onFact" | "onInvoke",
        event: (ModuleRuntime["emitForFact"] extends (event: infer E) => any ? E : never)
            | (ModuleRuntime["emitForInvoke"] extends (event: infer E) => any ? E : never),
    ): ModuleEmission[] {
        const out: ModuleEmission[] = [];
        const traceModules = process.env.ARKTAINT_TRACE_MODULE_HOOKS === "1";
        for (const { moduleId, session, sourcePath, runtimeContext } of this.sessions) {
            if (this.failedModuleIds.has(moduleId)) continue;
            const callback = session[hook];
            if (!callback) continue;
            const auditEntry = this.audit.moduleStats[moduleId];
            if (hook === "onFact") {
                auditEntry.factHookCalls += 1;
            } else {
                auditEntry.invokeHookCalls += 1;
            }
            const staged: ModuleEmission[] = [];
            const hookStartedAt = process.hrtime.bigint();
            try {
                if (traceModules) {
                    process.stderr.write(`[module-hook] start hook=${hook} module=${moduleId}\n`);
                }
                (event as any).__moduleAuditEntry = auditEntry;
                const authorEvent = hook === "onInvoke"
                    ? createInvokeEvent(moduleId, event as InternalRawModuleInvokeEvent, runtimeContext)
                    : createFactEvent(moduleId, event as InternalRawModuleFactEvent, runtimeContext);
                const emitted = callback(authorEvent as any);
                if (!emitted || emitted.length === 0) continue;
                for (const item of emitted) {
                    if (!item || !item.fact || typeof item.reason !== "string" || item.reason.trim().length === 0) {
                        throw new ModuleRuntimeDiagnosticError(
                            `module ${moduleId} returned an invalid ${hook} emission`,
                            `MODULE_${normalizePhaseCode(hook)}_INVALID_EMISSION`,
                            "Check whether every emitted item contains a fact and a non-empty reason. Do not return undefined or malformed objects.",
                        );
                    }
                    staged.push(item);
                }
                if (hook === "onFact") {
                    auditEntry.factEmissionCount += staged.length;
                } else {
                    auditEntry.invokeEmissionCount += staged.length;
                }
                auditEntry.totalEmissionCount += staged.length;
                for (const item of staged) {
                    pushModuleEmissionAuditSample(auditEntry, moduleId, hook, event as any, item);
                }
                if (traceModules) {
                    process.stderr.write(`[module-hook] done hook=${hook} module=${moduleId} emissions=${staged.length}\n`);
                }
            } catch (error) {
                if (traceModules) {
                    process.stderr.write(`[module-hook] error hook=${hook} module=${moduleId}\n`);
                }
                this.disableModule(moduleId, hook, error, sourcePath);
                continue;
            } finally {
                const elapsedMs = Number(process.hrtime.bigint() - hookStartedAt) / 1_000_000;
                if (hook === "onFact") {
                    auditEntry.factHookMs += elapsedMs;
                } else {
                    auditEntry.invokeHookMs += elapsedMs;
                }
                delete (event as any).__moduleAuditEntry;
            }
            out.push(...staged);
        }
        return out;
    }

    shouldSkipCopyEdge(event: ModuleRuntime["shouldSkipCopyEdge"] extends (event: infer E) => any ? E : never): boolean {
        for (const { moduleId, session, sourcePath } of this.sessions) {
            if (this.failedModuleIds.has(moduleId)) continue;
            const auditEntry = this.audit.moduleStats[moduleId];
            auditEntry.copyEdgeChecks += 1;
            let shouldSkip = false;
            const hookStartedAt = process.hrtime.bigint();
            try {
                (event as any).__moduleAuditEntry = auditEntry;
                shouldSkip = session.shouldSkipCopyEdge?.(createCopyEdgeEvent(moduleId, event)) === true;
            } catch (error) {
                this.disableModule(moduleId, "shouldSkipCopyEdge", error, sourcePath);
                continue;
            } finally {
                auditEntry.copyEdgeMs += Number(process.hrtime.bigint() - hookStartedAt) / 1_000_000;
                delete (event as any).__moduleAuditEntry;
            }
            if (shouldSkip) {
                auditEntry.skipCopyEdgeCount += 1;
                return true;
            }
        }
        return false;
    }

    disableModule(moduleId: string, hook: string, error: unknown, sourcePath?: string): void {
        if (this.failedModuleIds.has(moduleId)) return;
        const message = String((error as any)?.message || error);
        const classification = classifyModuleFailure(hook, error);
        const location = preferExtensionSourceLocation(extractErrorLocation(error), sourcePath);
        const locationSuffix = location.path
            ? location.line && location.column
                ? ` @ ${location.path}:${location.line}:${location.column}`
                : ` @ ${location.path}`
            : "";
        this.failedModuleIds.add(moduleId);
        this.audit.failedModuleIds = [...this.failedModuleIds.values()];
        this.audit.failureEvents.push({
            moduleId,
            phase: hook as "setup" | "onFact" | "onInvoke" | "shouldSkipCopyEdge",
            message,
            code: classification.code,
            advice: classification.advice,
            path: location.path,
            line: location.line,
            column: location.column,
            stackExcerpt: location.stackExcerpt,
            userMessage: `module ${moduleId} failed in ${hook}${locationSuffix}: ${message}`,
        });
        console.warn(`module ${moduleId} disabled after ${hook} failure${locationSuffix}: ${message}`);
    }
}

function hasCanonicalInvokeIdentity(
    event: Pick<InternalRawModuleInvokeEvent, "canonicalApiId" | "occurrenceId" | "rawOccurrenceId" | "semanticEffectSites">,
): boolean {
    return !!String(event.canonicalApiId || "").trim()
        && !!String(event.occurrenceId || "").trim()
        && !!String(event.rawOccurrenceId || "").trim();
}

export function createModuleRuntime(
    modules: TaintModule[],
    ctx: InternalRawModuleSetupContext,
): ModuleRuntime {
    const sessions: RegisteredSession[] = [];
    const deferredBindingCollector = createDeferredBindingCollector();
    const runtime = new DefaultModuleRuntime(
        modules,
        sessions,
        deferredBindingCollector,
    );

    for (const module of modules) {
        let session: ModuleSession | void;
        const moduleDeferredBindings = createDeferredBindingCollector();
        const setupStartedAtMs = Date.now();
        const setupRaw: InternalRawModuleSetupContext = {
            ...ctx,
            moduleSetupStartedAtMs: setupStartedAtMs,
            moduleSetupModuleId: module.id,
        };
        (setupRaw as any).__moduleAuditEntry = (runtime as any).audit?.moduleStats?.[module.id];
        try {
            ctx.log(`[ModuleRuntime] setup start id=${module.id}`);
            session = module.setup?.(createSetupContext(setupRaw, {
                moduleId: module.id,
                deferredBindings: moduleDeferredBindings,
            }));
            ctx.log(`[ModuleRuntime] setup done id=${module.id} elapsed_ms=${Date.now() - setupStartedAtMs}`);
        } catch (error) {
            runtime.disableModule(module.id, "setup", error, getExtensionSourceModulePath(module));
            continue;
        }
        for (const binding of moduleDeferredBindings.all()) {
            deferredBindingCollector.add(binding);
        }
        if (!session) continue;
        sessions.push({
            moduleId: module.id,
            session,
            sourcePath: getExtensionSourceModulePath(module),
            runtimeContext: createSetupContext(ctx, {
                moduleId: module.id,
            }),
        });
    }

    return runtime;
}
