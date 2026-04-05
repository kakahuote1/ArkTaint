import { PagNode } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkParameterRef } from "../../../../arkanalyzer/out/src/core/base/Ref";
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
    ModuleDebugApi,
    ModuleEmission,
    ModuleEmitCollector,
    ModuleEmitApi,
    ModuleEmitOptions,
    ModuleFactEvent,
    ModuleInvokeEvent,
    ModuleInvokeMatchApi,
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
    ModuleMethodsApi,
    ModuleRuntime,
    ModuleResolvedCallbackMethod,
    ModuleResolvedCallbackParamBinding,
    ModuleSession,
    ModuleSetupContext,
    ModuleSetupCallbackApi,
    ModuleScanApi,
    ModuleNodeRelay,
    ModuleFieldRelay,
    RawModuleCopyEdgeEvent,
    RawModuleFactEvent,
    RawModuleInvokeEvent,
    RawModuleSetupContext,
    TaintModule,
    ModuleValueEmitOptions,
} from "../../kernel/contracts/ModuleContract";
import { collectNodeIdsFromValue, collectObjectNodeIdsFromValue } from "../../kernel/contracts/HarmonyModuleUtils";
import { getMethodBySignature } from "../../kernel/contracts/MethodLookup";
import { TaintFact } from "../../kernel/model/TaintFact";
import { safeGetOrCreatePagNodes } from "../../kernel/contracts/PagNodeResolution";
import {
    extractErrorLocation,
    getExtensionSourceModulePath,
    preferExtensionSourceLocation,
} from "../ExtensionLoaderUtils";

interface RegisteredSession {
    moduleId: string;
    session: ModuleSession;
    sourcePath?: string;
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
    event: RawModuleFactEvent,
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
    event: RawModuleFactEvent,
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

function buildSetupDebugApi(log: (msg: string) => void): ModuleSetupContext["debug"] {
    return {
        summary(label, metrics, options = {}) {
            if (options.enabled === false) return;
            const parts = formatSummaryParts(metrics, options.omitEmpty !== false);
            if (parts.length === 0) return;
            log(`[${label}] ${parts.join(", ")}`);
        },
    };
}

function createAnalysisApi(raw: RawModuleSetupContext): ModuleAnalysisApi {
    const nodeIdsForValue = (value: any, anchorStmt?: any): number[] => {
        if (!raw.pag) return [];
        const direct = collectNodeIdsFromValue(raw.pag, value);
        if (direct.size > 0) {
            return [...direct.values()];
        }
        const fallback = safeGetOrCreatePagNodes(raw.pag, value, anchorStmt);
        return fallback ? [...fallback.values()] : [];
    };
    const objectNodeIdsForValue = (value: any): number[] => {
        if (!raw.pag) return [];
        return [...collectObjectNodeIdsFromValue(raw.pag, value).values()];
    };
    return {
        nodeIdsForValue,
        objectNodeIdsForValue,
        carrierNodeIdsForValue(value: any, anchorStmt?: any): number[] {
            return [...new Set<number>([
                ...nodeIdsForValue(value, anchorStmt),
                ...objectNodeIdsForValue(value),
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
    };
}

function resolveActiveModuleMethods(raw: RawModuleSetupContext): any[] {
    if (!raw.scene) {
        return [];
    }
    const allMethods = raw.scene.getMethods().filter(method => method.getName() !== "%dflt");
    if (!raw.allowedMethodSignatures || raw.allowedMethodSignatures.size === 0) {
        return allMethods;
    }
    return allMethods.filter(method => raw.allowedMethodSignatures!.has(method.getSignature().toString()));
}

function createMethodsApi(raw: RawModuleSetupContext): ModuleMethodsApi {
    const methods = resolveActiveModuleMethods(raw);
    return {
        all(): any[] {
            return methods;
        },
        byName(methodName: string): any[] {
            return methods.filter(method => method.getName?.() === methodName);
        },
        byClassName(className: string): any[] {
            return methods.filter(method => {
                const sig = method.getSignature?.();
                const declaringClassName = sig?.getDeclaringClassSignature?.()?.getClassName?.() || "";
                return declaringClassName === className;
            });
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

function matchesOwnerScanFilter(
    ownerMethodSignature: string,
    ownerMethodName: string,
    declaringClassName: string,
    filter?: {
        ownerMethodSignature?: string;
        ownerMethodName?: string;
        declaringClassName?: string;
        declaringClassIncludes?: string;
    },
): boolean {
    if (!filter) return true;
    if (filter.ownerMethodSignature && filter.ownerMethodSignature !== ownerMethodSignature) return false;
    if (filter.ownerMethodName && filter.ownerMethodName !== ownerMethodName) return false;
    if (filter.declaringClassName && filter.declaringClassName !== declaringClassName) return false;
    if (filter.declaringClassIncludes && !declaringClassName.includes(filter.declaringClassIncludes)) return false;
    return true;
}

function matchesInvokeScanFilter(
    isInstanceInvoke: boolean,
    methodName: string,
    declaringClassName: string,
    signature: string,
    argCount: number,
    filter?: ModuleInvokeScanFilter,
): boolean {
    if (!filter) return true;
    if (filter.instanceOnly && !isInstanceInvoke) return false;
    if (filter.staticOnly && isInstanceInvoke) return false;
    if (filter.methodName && filter.methodName !== methodName) return false;
    if (filter.declaringClassName && filter.declaringClassName !== declaringClassName) return false;
    if (filter.declaringClassIncludes && !declaringClassName.includes(filter.declaringClassIncludes)) return false;
    if (filter.signature && filter.signature !== signature) return false;
    if (filter.signatureIncludes && !signature.includes(filter.signatureIncludes)) return false;
    if (filter.minArgs !== undefined && argCount < filter.minArgs) return false;
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
    const param = String(decorator?.getParam?.() || "").trim();
    const content = String(decorator?.getContent?.() || "").trim();
    return {
        kind,
        param: param || undefined,
        content: content || undefined,
    };
}

function matchesDecoratedFieldScanFilter(
    className: string,
    fieldName: string,
    decorators: ModuleScannedDecorator[],
    filter?: ModuleDecoratedFieldScanFilter,
): boolean {
    if (!filter) return true;
    if (filter.className && filter.className !== className) return false;
    if (filter.classNameIncludes && !className.includes(filter.classNameIncludes)) return false;
    if (filter.fieldName && filter.fieldName !== fieldName) return false;
    if (filter.decoratorKind && !decorators.some(decorator => decorator.kind === filter.decoratorKind)) return false;
    if (filter.decoratorKinds && filter.decoratorKinds.length > 0) {
        const required = new Set(filter.decoratorKinds);
        const observed = new Set(decorators.map(decorator => decorator.kind));
        let hasAny = false;
        for (const kind of required) {
            if (observed.has(kind)) {
                hasAny = true;
                break;
            }
        }
        if (!hasAny) return false;
    }
    return true;
}

function createScanApi(raw: RawModuleSetupContext): ModuleScanApi {
    const methods = resolveActiveModuleMethods(raw);
    const analysis = createAnalysisApi(raw);
    return {
        invokes(filter?: ModuleInvokeScanFilter): ModuleScannedInvoke[] {
            const out: ModuleScannedInvoke[] = [];
            for (const method of methods) {
                const ownerMethodSignature = method.getSignature?.().toString?.() || "";
                const ownerDeclaringClassName = method.getDeclaringArkClass?.()?.getName?.()
                    || method.getSignature?.()?.getDeclaringClassSignature?.()?.getClassName?.()
                    || "";
                const cfg = method.getCfg?.();
                if (!cfg) continue;
                for (const stmt of cfg.getStmts()) {
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
                    if (!matchesInvokeScanFilter(
                        isInstanceInvoke,
                        methodName,
                        declaringClassName,
                        signature,
                        args.length,
                        filter,
                    )) {
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
                            matchesSignature(expected: string): boolean {
                                return signature === expected;
                            },
                            matchesMethod(expected: string): boolean {
                                return methodName === expected;
                            },
                            matchesClass(expected: string): boolean {
                                return declaringClassName === expected;
                            },
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
                            return analysis.nodeIdsForValue(value, stmt);
                        },
                        argObjectNodeIds(index: number): number[] {
                            const value = index >= 0 && index < args.length ? args[index] : undefined;
                            return analysis.objectNodeIdsForValue(value);
                        },
                        argCarrierNodeIds(index: number): number[] {
                            const value = index >= 0 && index < args.length ? args[index] : undefined;
                            return analysis.carrierNodeIdsForValue(value, stmt);
                        },
                        baseNodeIds(): number[] {
                            if (!isInstanceInvoke) return [];
                            return analysis.nodeIdsForValue(invokeExpr.getBase(), stmt);
                        },
                        baseObjectNodeIds(): number[] {
                            if (!isInstanceInvoke) return [];
                            return analysis.objectNodeIdsForValue(invokeExpr.getBase());
                        },
                        baseCarrierNodeIds(): number[] {
                            if (!isInstanceInvoke) return [];
                            return analysis.carrierNodeIdsForValue(invokeExpr.getBase(), stmt);
                        },
                        resultNodeIds(): number[] {
                            return resultValue !== undefined
                                ? analysis.nodeIdsForValue(resultValue, stmt)
                                : [];
                        },
                        resultCarrierNodeIds(): number[] {
                            return resultValue !== undefined
                                ? analysis.carrierNodeIdsForValue(resultValue, stmt)
                                : [];
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
            for (const method of methods) {
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
                    if (filter?.paramNameIncludes && !paramName.includes(filter.paramNameIncludes)) continue;
                    if (filter?.paramTypeIncludes && !paramType.includes(filter.paramTypeIncludes)) continue;
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
                            return analysis.nodeIdsForValue(left, stmt);
                        },
                        localObjectNodeIds(): number[] {
                            return analysis.objectNodeIdsForValue(left);
                        },
                        localCarrierNodeIds(): number[] {
                            return analysis.carrierNodeIdsForValue(left, stmt);
                        },
                    });
                }
            }
            return out;
        },
        assigns(filter?: ModuleAssignScanFilter): ModuleScannedAssign[] {
            const out: ModuleScannedAssign[] = [];
            for (const method of methods) {
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
                            return analysis.nodeIdsForValue(left, stmt);
                        },
                        leftCarrierNodeIds(): number[] {
                            return analysis.carrierNodeIdsForValue(left, stmt);
                        },
                        rightNodeIds(): number[] {
                            return analysis.nodeIdsForValue(right, stmt);
                        },
                        rightCarrierNodeIds(): number[] {
                            return analysis.carrierNodeIdsForValue(right, stmt);
                        },
                    });
                }
            }
            return out;
        },
        fieldLoads(filter?: ModuleFieldLoadScanFilter): ModuleScannedFieldLoad[] {
            const out: ModuleScannedFieldLoad[] = [];
            for (const method of methods) {
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
                    if (!isAssignStmtLike(stmt)) continue;
                    const left = stmt.getLeftOp();
                    const right = stmt.getRightOp();
                    if (!isFieldRefLike(right)) continue;
                    const base = right.getBase();
                    const fieldName = resolveFieldName(right);
                    if (!fieldName) continue;
                    if (filter?.fieldName && filter.fieldName !== fieldName) continue;
                    if (!matchesBaseLocalFilter(base, filter)) continue;
                    out.push({
                        ...meta,
                        stmt,
                        fieldName,
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
                            return analysis.nodeIdsForValue(base, stmt);
                        },
                        baseObjectNodeIds(): number[] {
                            return analysis.objectNodeIdsForValue(base);
                        },
                        baseCarrierNodeIds(): number[] {
                            return analysis.carrierNodeIdsForValue(base, stmt);
                        },
                        resultNodeIds(): number[] {
                            return analysis.nodeIdsForValue(left, stmt);
                        },
                        resultObjectNodeIds(): number[] {
                            return analysis.objectNodeIdsForValue(left);
                        },
                        resultCarrierNodeIds(): number[] {
                            return analysis.carrierNodeIdsForValue(left, stmt);
                        },
                    });
                }
            }
            return out;
        },
        fieldStores(filter?: ModuleFieldStoreScanFilter): ModuleScannedFieldStore[] {
            const out: ModuleScannedFieldStore[] = [];
            for (const method of methods) {
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
                    if (!isAssignStmtLike(stmt)) continue;
                    const left = stmt.getLeftOp();
                    const right = stmt.getRightOp();
                    if (!isFieldRefLike(left)) continue;
                    const base = left.getBase();
                    const fieldName = resolveFieldName(left);
                    if (!fieldName) continue;
                    if (filter?.fieldName && filter.fieldName !== fieldName) continue;
                    if (!matchesBaseLocalFilter(base, filter)) continue;
                    if (!matchesSourceLocalFilter(right, filter)) continue;
                    out.push({
                        ...meta,
                        stmt,
                        fieldName,
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
                            return analysis.nodeIdsForValue(base, stmt);
                        },
                        baseObjectNodeIds(): number[] {
                            return analysis.objectNodeIdsForValue(base);
                        },
                        baseCarrierNodeIds(): number[] {
                            return analysis.carrierNodeIdsForValue(base, stmt);
                        },
                        valueNodeIds(): number[] {
                            return analysis.nodeIdsForValue(right, stmt);
                        },
                        valueObjectNodeIds(): number[] {
                            return analysis.objectNodeIdsForValue(right);
                        },
                        valueCarrierNodeIds(): number[] {
                            return analysis.carrierNodeIdsForValue(right, stmt);
                        },
                    });
                }
            }
            return out;
        },
        decoratedFields(filter?: ModuleDecoratedFieldScanFilter): ModuleScannedDecoratedField[] {
            const out: ModuleScannedDecoratedField[] = [];
            for (const cls of raw.scene.getClasses?.() || []) {
                const className = cls.getName?.() || "";
                for (const field of cls.getFields?.() || []) {
                    const fieldName = field.getName?.() || "";
                    const fieldSignature = field.getSignature?.()?.toString?.() || "";
                    const decorators = (field.getDecorators?.() || [])
                        .map((decorator: any) => normalizeDecoratorEntry(decorator))
                        .filter((decorator: ModuleScannedDecorator | undefined): decorator is ModuleScannedDecorator => Boolean(decorator));
                    if (decorators.length === 0) continue;
                    if (!matchesDecoratedFieldScanFilter(className, fieldName, decorators, filter)) continue;
                    out.push({
                        className,
                        fieldName,
                        fieldSignature,
                        decorators(): ModuleScannedDecorator[] {
                            return decorators.map(decorator => ({ ...decorator }));
                        },
                        decoratorKinds(): string[] {
                            return decorators.map(decorator => decorator.kind);
                        },
                        hasDecorator(kind: string): boolean {
                            return decorators.some(decorator => decorator.kind === kind);
                        },
                        decoratorParams(kind: string): string[] {
                            return decorators
                                .filter(decorator => decorator.kind === kind)
                                .map(decorator => decorator.param)
                                .filter((value: string | undefined): value is string => Boolean(value));
                        },
                    });
                }
            }
            return out;
        },
    };
}

function normalizeFieldPathInput(fieldPath: string | string[]): string[] {
    return Array.isArray(fieldPath) ? [...fieldPath] : [fieldPath];
}

function createBridgeApi(): ModuleBridgeApi {
    return {
        nodeRelay(): ModuleNodeRelay {
            const targetsBySourceNodeId = new Map<number, Set<number>>();
            const ensureTargets = (sourceNodeId: number): Set<number> => {
                let targets = targetsBySourceNodeId.get(sourceNodeId);
                if (!targets) {
                    targets = new Set<number>();
                    targetsBySourceNodeId.set(sourceNodeId, targets);
                }
                return targets;
            };
            return {
                connect(sourceNodeId: number, targetNodeId: number): void {
                    ensureTargets(sourceNodeId).add(targetNodeId);
                },
                connectMany(sourceNodeIds: Iterable<number>, targetNodeIds: Iterable<number>): void {
                    const targetList = [...targetNodeIds];
                    for (const sourceNodeId of sourceNodeIds) {
                        const targets = ensureTargets(sourceNodeId);
                        for (const targetNodeId of targetList) {
                            targets.add(targetNodeId);
                        }
                    }
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
            };
        },
        fieldRelay(): ModuleFieldRelay {
            const fieldTargetsBySourceFieldKey = new Map<string, Array<{ targetNodeId: number; fieldPath: string[] }>>();
            const loadTargetsBySourceFieldKey = new Map<string, Set<number>>();
            const fieldDedup = new Set<string>();
            return {
                connectField(sourceNodeId, sourceFieldName, targetNodeId, fieldPath): void {
                    const key = `${sourceNodeId}#${sourceFieldName}`;
                    const normalizedFieldPath = normalizeFieldPathInput(fieldPath);
                    const dedupKey = `${key}->${targetNodeId}#${normalizedFieldPath.join(".")}`;
                    if (fieldDedup.has(dedupKey)) return;
                    fieldDedup.add(dedupKey);
                    let items = fieldTargetsBySourceFieldKey.get(key);
                    if (!items) {
                        items = [];
                        fieldTargetsBySourceFieldKey.set(key, items);
                    }
                    items.push({
                        targetNodeId,
                        fieldPath: normalizedFieldPath,
                    });
                },
                connectFields(sourceNodeIds, sourceFieldName, targetNodeIds, fieldPath): void {
                    const targetList = [...targetNodeIds];
                    for (const sourceNodeId of sourceNodeIds) {
                        for (const targetNodeId of targetList) {
                            this.connectField(sourceNodeId, sourceFieldName, targetNodeId, fieldPath);
                        }
                    }
                },
                connectLoadCurrentFieldTail(sourceNodeId, sourceFieldName, targetNodeId): void {
                    const key = `${sourceNodeId}#${sourceFieldName}`;
                    let targets = loadTargetsBySourceFieldKey.get(key);
                    if (!targets) {
                        targets = new Set<number>();
                        loadTargetsBySourceFieldKey.set(key, targets);
                    }
                    targets.add(targetNodeId);
                },
                connectLoadCurrentFieldTails(sourceNodeIds, sourceFieldName, targetNodeIds): void {
                    const targetList = [...targetNodeIds];
                    for (const sourceNodeId of sourceNodeIds) {
                        for (const targetNodeId of targetList) {
                            this.connectLoadCurrentFieldTail(sourceNodeId, sourceFieldName, targetNodeId);
                        }
                    }
                },
                emit(event, fieldReason, loadReason = fieldReason, options = {}): ModuleEmission[] | undefined {
                    const fieldHead = event.current.fieldHead();
                    if (!fieldHead) return undefined;
                    const key = `${event.current.nodeId}#${fieldHead}`;
                    const collector = event.emit.collector();
                    const fieldTargets = fieldTargetsBySourceFieldKey.get(key) || [];
                    const fieldTail = event.current.fieldTail();
                    for (const target of fieldTargets) {
                        const targetFieldPath = fieldTail && fieldTail.length > 0
                            ? [...target.fieldPath, ...fieldTail]
                            : [...target.fieldPath];
                        collector.push(event.emit.toField(target.targetNodeId, targetFieldPath, fieldReason, options));
                    }
                    const loadTargets = loadTargetsBySourceFieldKey.get(key);
                    if (loadTargets && loadTargets.size > 0) {
                        collector.push(event.emit.toCurrentFieldTailNodes(loadTargets, loadReason, options));
                    }
                    return collector.done();
                },
            };
        },
    };
}

function collectCallbackMethodsWithQueries(
    scene: any,
    queries: RawModuleSetupContext["queries"],
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

    for (const method of queries.resolveMethodsFromCallable(scene, callbackValue, { maxCandidates: options.maxCandidates })) {
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
    queries: RawModuleSetupContext["queries"],
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
                    const nodes = safeGetOrCreatePagNodes(pag, left, paramStmt) || pag.getNodesByValue(left);
                    return nodes ? [...nodes.values()] : [];
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

function collectCallbackParamNodeIdsWithQueries(
    scene: any,
    pag: any,
    queries: RawModuleSetupContext["queries"],
    callbackValue: any,
    paramIndex: number,
    options: ModuleCallbackResolveOptions = {},
): number[] {
    const out = new Set<number>();
    for (const binding of collectCallbackParamBindingsWithQueries(scene, pag, queries, callbackValue, paramIndex, options)) {
        for (const nodeId of binding.localNodeIds()) {
            out.add(nodeId);
        }
    }
    return [...out.values()];
}

function createSetupCallbackApi(raw: RawModuleSetupContext): ModuleSetupCallbackApi {
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

function createSetupContext(raw: RawModuleSetupContext): ModuleSetupContext {
    const analysis = createAnalysisApi(raw);
    return {
        raw,
        methods: createMethodsApi(raw),
        scan: createScanApi(raw),
        bridge: createBridgeApi(),
        callbacks: createSetupCallbackApi(raw),
        analysis,
        log: raw.log,
        debug: buildSetupDebugApi(raw.log),
    };
}

function createCurrentFactView(event: RawModuleFactEvent): ModuleCurrentFactView {
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

function createCurrentNodeView(event: RawModuleCopyEdgeEvent): ModuleCurrentNodeView {
    return {
        nodeId: event.node.getID(),
        contextId: event.contextId,
        value: event.node.getValue?.(),
    };
}

function createEmitApi(
    event: RawModuleFactEvent,
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
        const anchorStmt = options?.anchorStmt
            ?? ((event as RawModuleInvokeEvent).stmt);
        if (!anchorStmt) {
            return [];
        }
        const nodes = safeGetOrCreatePagNodes(event.pag, targetValue, anchorStmt);
        return nodes ? [...nodes.values()] : [];
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

function createCallView(event: RawModuleInvokeEvent) {
    return {
        signature: event.callSignature,
        methodName: event.methodName,
        declaringClassName: event.declaringClassName,
        argCount: event.args.length,
        matchesSignature(expected: string): boolean {
            return event.callSignature === expected;
        },
        matchesMethod(expected: string): boolean {
            return event.methodName === expected;
        },
        matchesClass(expected: string): boolean {
            return event.declaringClassName === expected;
        },
    };
}

function createValuesView(event: RawModuleInvokeEvent) {
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

function matchesCurrentFactValue(event: RawModuleInvokeEvent, value: any): boolean {
    const analysis = createAnalysisApi(event);
    const candidateNodeIds = new Set<number>([
        ...analysis.nodeIdsForValue(value, event.stmt),
        ...analysis.objectNodeIdsForValue(value),
    ]);
    return candidateNodeIds.has(event.node.getID());
}

function createInvokeMatchApi(event: RawModuleInvokeEvent): ModuleInvokeMatchApi {
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
    event: RawModuleInvokeEvent,
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

function createCallbackApi(event: RawModuleInvokeEvent): ModuleCallbackApi {
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
    };
}

function createFactEvent(moduleId: string, raw: RawModuleFactEvent): ModuleFactEvent {
    const entry = (raw as any).__moduleAuditEntry as ModuleAuditEntry;
    return {
        ...createSetupContext(raw),
        raw,
        current: createCurrentFactView(raw),
        emit: createEmitApi(raw),
        debug: buildDebugApi(moduleId, entry, raw.log),
    };
}

function createInvokeEvent(moduleId: string, raw: RawModuleInvokeEvent): ModuleInvokeEvent {
    return {
        ...createFactEvent(moduleId, raw),
        raw,
        call: createCallView(raw),
        values: createValuesView(raw),
        callbacks: createCallbackApi(raw),
        match: createInvokeMatchApi(raw),
    };
}

function createCopyEdgeEvent(moduleId: string, raw: RawModuleCopyEdgeEvent): ModuleCopyEdgeEvent {
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
        factEmissionCount: 0,
        invokeEmissionCount: 0,
        totalEmissionCount: 0,
        skipCopyEdgeCount: 0,
        debugHitCount: 0,
        debugSkipCount: 0,
        debugLogCount: 0,
        recentDebugMessages: [],
    };
}

class DefaultModuleRuntime implements ModuleRuntime {
    private readonly failedModuleIds = new Set<string>();
    private readonly audit: ModuleAuditSnapshot;

    constructor(
        private readonly modules: TaintModule[],
        private readonly sessions: RegisteredSession[],
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
                    },
                ]),
            ),
        };
    }

    emitForFact(event: RawModuleFactEvent): ModuleEmission[] {
        return this.collectEmissions("onFact", event);
    }

    emitForInvoke(event: RawModuleInvokeEvent): ModuleEmission[] {
        return this.collectEmissions("onInvoke", event);
    }

    private collectEmissions(
        hook: "onFact" | "onInvoke",
        event: RawModuleFactEvent | RawModuleInvokeEvent,
    ): ModuleEmission[] {
        const out: ModuleEmission[] = [];
        for (const { moduleId, session, sourcePath } of this.sessions) {
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
            try {
                (event as any).__moduleAuditEntry = auditEntry;
                const authorEvent = hook === "onInvoke"
                    ? createInvokeEvent(moduleId, event as RawModuleInvokeEvent)
                    : createFactEvent(moduleId, event as RawModuleFactEvent);
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
            } catch (error) {
                this.disableModule(moduleId, hook, error, sourcePath);
                continue;
            } finally {
                delete (event as any).__moduleAuditEntry;
            }
            out.push(...staged);
        }
        return out;
    }

    shouldSkipCopyEdge(event: RawModuleCopyEdgeEvent): boolean {
        for (const { moduleId, session, sourcePath } of this.sessions) {
            if (this.failedModuleIds.has(moduleId)) continue;
            const auditEntry = this.audit.moduleStats[moduleId];
            auditEntry.copyEdgeChecks += 1;
            let shouldSkip = false;
            try {
                (event as any).__moduleAuditEntry = auditEntry;
                shouldSkip = session.shouldSkipCopyEdge?.(createCopyEdgeEvent(moduleId, event)) === true;
            } catch (error) {
                this.disableModule(moduleId, "shouldSkipCopyEdge", error, sourcePath);
                continue;
            } finally {
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

export function createModuleRuntime(
    modules: TaintModule[],
    ctx: RawModuleSetupContext,
): ModuleRuntime {
    const sessions: RegisteredSession[] = [];
    const runtime = new DefaultModuleRuntime(
        modules,
        sessions,
    );

    for (const module of modules) {
        let session: ModuleSession | void;
        try {
            session = module.setup?.(createSetupContext(ctx));
        } catch (error) {
            runtime.disableModule(module.id, "setup", error, getExtensionSourceModulePath(module));
            continue;
        }
        if (!session) continue;
        sessions.push({
            moduleId: module.id,
            session,
            sourcePath: getExtensionSourceModulePath(module),
        });
    }

    return runtime;
}
