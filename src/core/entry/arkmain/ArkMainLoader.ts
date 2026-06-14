import * as fs from "fs";
import * as path from "path";
import type { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { ArkAssignStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import type { ArkMethod } from "../../../../arkanalyzer/out/src/core/model/ArkMethod";
import {
    isAnalysisLoadableAssetStatus,
    validateAssetDocument,
    type AnalysisAssetLoadMode,
    type AssetDocumentBase,
    type AssetEndpoint,
    type CallbackLocator,
    type EntryCallbackRegisterTemplate,
    type EntryLifecycleTemplate,
    type EntrySurface,
    type InvokeSurface,
} from "../../assets/schema";
import {
    resolveCallbackMethodsFromValueWithReturns,
} from "../../substrate/queries/CallbackBindingQuery";
import {
    resolveMethodsFromAnonymousObjectCarrierByField,
} from "../../substrate/queries/CalleeResolver";
import type {
    ArkMainEntryFact,
    ArkMainFactKind,
    ArkMainOwnerKind,
    ArkMainPhaseName,
} from "./ArkMainTypes";

export interface ArkMainLoaderOptions {
    includeBuiltinArkMain?: boolean;
    arkMainRoots?: string[];
    enabledArkMainProjects?: string[];
    disabledArkMainProjects?: string[];
    semanticflowEvaluationModelRoots?: string[];
    onWarning?: (warning: string) => void;
}

export interface ArkMainLoadResult {
    methods: ArkMethod[];
    facts: ArkMainEntryFact[];
    loadedFiles: string[];
    warnings: string[];
    discoveredArkMainProjects: string[];
    enabledArkMainProjects: string[];
}

interface ProjectArkMainAssetPack {
    projectId: string;
    files: string[];
}

export function loadArkMainSeeds(
    scene: Scene,
    options: ArkMainLoaderOptions = {},
): ArkMainLoadResult {
    const warnings: string[] = [];
    const loadedFiles = new Set<string>();
    const roots = getArkMainRoots(options);
    const projectPacks = collectProjectArkMainAssetPacks(roots);
    const discoveredArkMainProjects = projectPacks.map(spec => spec.projectId);
    const evaluationRoots = normalizeRootList(options.semanticflowEvaluationModelRoots);
    const enabledArkMainProjectSet = resolveEnabledArkMainProjects(
        options,
        collectEvaluationArkMainProjectIds(projectPacks, evaluationRoots),
    );
    const enabledArkMainProjects = [...enabledArkMainProjectSet.values()]
        .sort((a, b) => a.localeCompare(b));
    const methods: ArkMethod[] = [];
    const facts: ArkMainEntryFact[] = [];
    const methodSignatures = new Set<string>();

    for (const pack of projectPacks) {
        if (!enabledArkMainProjectSet.has(pack.projectId)) {
            continue;
        }
        for (const file of pack.files) {
            const loadResult = loadArkMainAssetFile(
                scene,
                file,
                warnings,
                options.onWarning,
                resolveAssetLoadMode(file, evaluationRoots),
            );
            if (!loadResult) {
                continue;
            }
            loadedFiles.add(path.resolve(file));
            for (const fact of loadResult.facts) {
                facts.push(fact);
                const signature = fact.method.getSignature?.()?.toString?.() || "";
                if (signature && !methodSignatures.has(signature)) {
                    methodSignatures.add(signature);
                    methods.push(fact.method);
                }
            }
        }
    }

    for (const requested of enabledArkMainProjects) {
        if (!discoveredArkMainProjects.includes(requested)) {
            pushWarning(warnings, options.onWarning, `requested arkmain project not found: ${requested}`);
        }
    }
    return {
        methods,
        facts,
        loadedFiles: [...loadedFiles.values()].sort((a, b) => a.localeCompare(b)),
        warnings,
        discoveredArkMainProjects: discoveredArkMainProjects.sort((a, b) => a.localeCompare(b)),
        enabledArkMainProjects,
    };
}

export function inspectArkMainProjects(options: ArkMainLoaderOptions = {}): Pick<
    ArkMainLoadResult,
    "warnings" | "discoveredArkMainProjects" | "enabledArkMainProjects" | "loadedFiles"
> {
    const warnings: string[] = [];
    const roots = getArkMainRoots(options);
    const discoveredPacks = collectProjectArkMainAssetPacks(roots);
    const discoveredArkMainProjects = discoveredPacks.map(spec => spec.projectId);
    const evaluationRoots = normalizeRootList(options.semanticflowEvaluationModelRoots);
    const enabledArkMainProjects = [...resolveEnabledArkMainProjects(
        options,
        collectEvaluationArkMainProjectIds(discoveredPacks, evaluationRoots),
    ).values()]
        .sort((a, b) => a.localeCompare(b));
    for (const requested of enabledArkMainProjects) {
        if (!discoveredArkMainProjects.includes(requested)) {
            pushWarning(warnings, options.onWarning, `requested arkmain project not found: ${requested}`);
        }
    }
    const loadedFiles = discoveredPacks
        .flatMap(spec => spec.files)
        .map(file => path.resolve(file))
        .sort((a, b) => a.localeCompare(b));
    return {
        warnings,
        discoveredArkMainProjects: discoveredArkMainProjects.sort((a, b) => a.localeCompare(b)),
        enabledArkMainProjects,
        loadedFiles,
    };
}

function getArkMainRoots(options: ArkMainLoaderOptions): string[] {
    const explicit = resolveExistingDirectories([
        ...(options.arkMainRoots || []),
        ...(options.semanticflowEvaluationModelRoots || []),
    ]);
    if (explicit.length > 0) {
        return explicit;
    }
    const preferredSourceRoot = path.resolve(__dirname, "../../../../src/models");
    if (fs.existsSync(preferredSourceRoot) && fs.statSync(preferredSourceRoot).isDirectory()) {
        return [preferredSourceRoot];
    }
    return [];
}

function resolveExistingDirectories(input?: string[]): string[] {
    return [...new Set((input || [])
        .map(item => path.resolve(item))
        .filter(item => fs.existsSync(item) && fs.statSync(item).isDirectory()))];
}

function normalizeRootList(input?: string[]): string[] {
    return [...new Set((input || [])
        .map(item => path.resolve(item))
        .filter(Boolean))];
}

function isUnderRoot(filePath: string, rootPath: string): boolean {
    const relative = path.relative(path.resolve(rootPath), path.resolve(filePath));
    return !!relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function resolveAssetLoadMode(filePath: string, evaluationRoots: readonly string[]): AnalysisAssetLoadMode {
    return evaluationRoots.some(root => isUnderRoot(filePath, root))
        ? "semanticflow-evaluation"
        : "trusted-analysis";
}

function collectEvaluationArkMainProjectIds(
    projectPacks: readonly ProjectArkMainAssetPack[],
    evaluationRoots: readonly string[],
): string[] {
    if (evaluationRoots.length === 0) {
        return [];
    }
    const out = new Set<string>();
    for (const pack of projectPacks) {
        if (pack.files.some(file => resolveAssetLoadMode(file, evaluationRoots) === "semanticflow-evaluation")) {
            out.add(pack.projectId);
        }
    }
    return [...out.values()].sort((a, b) => a.localeCompare(b));
}

function resolveEnabledArkMainProjects(
    options: ArkMainLoaderOptions,
    evaluationProjectIds: Iterable<string> = [],
): Set<string> {
    const disabled = new Set((options.disabledArkMainProjects || []).map(item => item.trim()).filter(Boolean));
    const enabled = new Set<string>();
    for (const projectId of evaluationProjectIds) {
        const normalized = projectId.trim();
        if (!normalized || disabled.has(normalized)) {
            continue;
        }
        enabled.add(normalized);
    }
    for (const projectId of options.enabledArkMainProjects || []) {
        const normalized = projectId.trim();
        if (!normalized || disabled.has(normalized)) {
            continue;
        }
        enabled.add(normalized);
    }
    return enabled;
}

function collectProjectArkMainAssetPacks(roots: string[]): ProjectArkMainAssetPack[] {
    const byProject = new Map<string, string[]>();
    for (const root of expandArkMainDiscoveryRoots(roots)) {
        const projectRoot = path.join(root, "project");
        if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
            continue;
        }
        const entries = fs.readdirSync(projectRoot, { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
            const packRoot = path.join(projectRoot, entry.name);
            const assetRoot = path.join(packRoot, "arkmain");
            if (!fs.existsSync(assetRoot) || !fs.statSync(assetRoot).isDirectory()) {
                continue;
            }
            const files = collectArkMainAssetFiles(assetRoot);
            if (files.length === 0) {
                continue;
            }
            const existing = byProject.get(entry.name) || [];
            byProject.set(entry.name, [...existing, ...files]);
        }
    }
    return [...byProject.entries()]
        .map(([projectId, files]) => ({
            projectId,
            files: [...new Set(files)].sort((a, b) => a.localeCompare(b)),
        }))
        .sort((a, b) => a.projectId.localeCompare(b.projectId));
}

function expandArkMainDiscoveryRoots(roots: string[]): string[] {
    const out = new Set<string>();
    for (const root of roots) {
        const resolved = path.resolve(root);
        out.add(resolved);
        const publishedSemanticFlowRoot = path.join(resolved, "generated_model_assets");
        if (fs.existsSync(publishedSemanticFlowRoot) && fs.statSync(publishedSemanticFlowRoot).isDirectory()) {
            out.add(path.resolve(publishedSemanticFlowRoot));
        }
    }
    return [...out.values()];
}

function collectArkMainAssetFiles(rootDir: string): string[] {
    if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
        return [];
    }
    const out: string[] = [];
    const queue = [rootDir];
    for (let head = 0; head < queue.length; head++) {
        const current = queue[head];
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                queue.push(fullPath);
                continue;
            }
            if (!entry.isFile()) {
                continue;
            }
            if (!entry.name.toLowerCase().endsWith(".json")) {
                continue;
            }
            out.push(path.resolve(fullPath));
        }
    }
    return out.sort((a, b) => a.localeCompare(b));
}

interface LoadedArkMainAsset {
    facts: ArkMainEntryFact[];
}

function loadArkMainAssetFile(
    scene: Scene,
    file: string,
    warnings: string[],
    onWarning?: (warning: string) => void,
    loadMode: AnalysisAssetLoadMode = "trusted-analysis",
): LoadedArkMainAsset | undefined {
    const assetPath = path.resolve(file);
    if (!fs.existsSync(assetPath) || !fs.statSync(assetPath).isFile()) {
        pushWarning(warnings, onWarning, `arkmain asset file not found: ${assetPath}`);
        return undefined;
    }
    let asset: AssetDocumentBase;
    try {
        asset = JSON.parse(fs.readFileSync(assetPath, "utf8")) as AssetDocumentBase;
    } catch (error) {
        pushWarning(warnings, onWarning, `failed to parse arkmain asset file ${assetPath}: ${String((error as any)?.message || error)}`);
        return undefined;
    }
    const validation = validateAssetDocument(asset);
    if (!validation.valid) {
        pushWarning(warnings, onWarning, `invalid arkmain asset file ${assetPath}: ${validation.errors.join("; ")}`);
        return undefined;
    }
    if (asset.plane !== "arkmain") {
        pushWarning(warnings, onWarning, `arkmain asset file has wrong plane ${asset.plane}: ${assetPath}`);
        return undefined;
    }
    if (!isAnalysisLoadableAssetStatus(asset.status, loadMode)) {
        pushWarning(warnings, onWarning, `arkmain asset status ${asset.status} is not loadable in ${loadMode}: ${assetPath}`);
        return undefined;
    }

    const facts: ArkMainEntryFact[] = [];
    const entrySurfacesById = new Map(
        (asset.surfaces || [])
            .filter((surface): surface is EntrySurface => surface.kind === "entry")
            .map(surface => [surface.surfaceId, surface] as const),
    );
    const invokeSurfacesById = new Map(
        (asset.surfaces || [])
            .filter((surface): surface is InvokeSurface => surface.kind === "invoke")
            .map(surface => [surface.surfaceId, surface] as const),
    );
    const lifecycleTemplatesById = new Map(
        (asset.effectTemplates || [])
            .filter((template): template is EntryLifecycleTemplate => template.kind === "entry.lifecycle")
            .map(template => [template.id, template] as const),
    );
    const callbackRegisterTemplatesById = new Map(
        (asset.effectTemplates || [])
            .filter((template): template is EntryCallbackRegisterTemplate => template.kind === "entry.callbackRegister")
            .map(template => [template.id, template] as const),
    );

    for (const binding of asset.bindings || []) {
        if (binding.plane !== "arkmain" || binding.role !== "entry") {
            continue;
        }
        const refs = Array.isArray(binding.effectTemplateRefs) ? binding.effectTemplateRefs : [];
        for (const ref of refs) {
            const lifecycleTemplate = lifecycleTemplatesById.get(ref);
            if (lifecycleTemplate) {
                const surface = entrySurfacesById.get(binding.surfaceId);
                if (!surface) {
                    continue;
                }
                const method = findEntryMethod(scene, surface.ownerName, lifecycleTemplate.method || surface.methodName);
                if (!method) {
                    pushWarning(
                        warnings,
                        onWarning,
                        `arkmain asset ${asset.id} entry ${surface.ownerName}.${lifecycleTemplate.method || surface.methodName} did not match a scene method`,
                    );
                    continue;
                }
                facts.push({
                    phase: normalizePhase(surface.phase),
                    kind: normalizeFactKind(lifecycleTemplate.entryKind || surface.entryKind),
                    method,
                    ownerKind: normalizeOwnerKind(surface.ownerKind),
                    reason: `Project arkmain asset ${asset.id} selected ${surface.ownerName}.${lifecycleTemplate.method || surface.methodName}`,
                    entryFamily: binding.semanticsFamily || lifecycleTemplate.entryKind || surface.entryKind,
                    entryShape: surface.entryKind,
                    recognitionLayer: "project_arkmain_asset",
                });
                continue;
            }

            const callbackTemplate = callbackRegisterTemplatesById.get(ref);
            if (callbackTemplate) {
                const surface = invokeSurfacesById.get(binding.surfaceId);
                if (!surface) {
                    continue;
                }
                facts.push(...lowerCallbackRegisterTemplate(
                    scene,
                    asset.id,
                    binding.semanticsFamily,
                    surface,
                    callbackTemplate,
                    warnings,
                    onWarning,
                ));
            }
        }
    }

    return { facts };
}

function lowerCallbackRegisterTemplate(
    scene: Scene,
    assetId: string,
    semanticsFamily: string | undefined,
    surface: InvokeSurface,
    template: EntryCallbackRegisterTemplate,
    warnings: string[],
    onWarning?: (warning: string) => void,
): ArkMainEntryFact[] {
    const out: ArkMainEntryFact[] = [];
    const seen = new Set<string>();
    for (const sourceMethod of scene.getMethods()) {
        const cfg = sourceMethod.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts?.() || []) {
            const invokeExpr = stmt?.getInvokeExpr?.();
            if (!invokeExpr || !matchesInvokeSurface(invokeExpr, surface)) {
                continue;
            }
            const callbackMethods = resolveCallbackMethodsFromLocator(scene, invokeExpr, template.callback);
            const registrationSignature = safeInvokeSignature(invokeExpr)
                || `${surface.ownerName || surface.functionName || surface.methodName || "invoke"}.${surface.methodName || surface.functionName || "call"}`;
            for (const callbackMethod of callbackMethods) {
                const callbackSignature = callbackMethod.getSignature?.()?.toString?.() || "";
                if (!callbackSignature) continue;
                const key = `${registrationSignature}|${callbackSignature}|${callbackLocatorKey(template.callback)}`;
                if (seen.has(key)) continue;
                seen.add(key);
                out.push({
                    phase: "interaction",
                    kind: "callback",
                    method: callbackMethod,
                    ownerKind: "component_owner",
                    reason: `Project arkmain asset ${assetId} registered callback ${callbackLocatorKey(template.callback)} at ${registrationSignature}`,
                    sourceMethod,
                    callbackFlavor: "ui_event",
                    callbackShape: template.callback.kind === "option" ? "options_object_slot" : "direct_callback_slot",
                    callbackSlotFamily: template.callback.kind === "option" ? "project_component_option_slot" : "ui_direct_slot",
                    callbackRecognitionLayer: "component_options",
                    callbackRegistrationSignature: registrationSignature,
                    callbackArgIndex: callbackLocatorArgIndex(template.callback),
                    entryFamily: semanticsFamily || template.callbackRole || "project_component_option_slot",
                    entryShape: template.callback.kind === "option" ? "options_object_slot" : "direct_callback_slot",
                    recognitionLayer: "component_options",
                });
            }
        }
    }
    if (out.length === 0) {
        pushWarning(
            warnings,
            onWarning,
            `arkmain asset ${assetId} callbackRegister ${surface.functionName || surface.methodName || surface.surfaceId} did not match a scene callback`,
        );
    }
    return out;
}

function matchesInvokeSurface(invokeExpr: any, surface: InvokeSurface): boolean {
    const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
    if (Number.isInteger(surface.argCount) && args.length !== surface.argCount) {
        return false;
    }
    const signature = safeInvokeSignature(invokeExpr);
    if (surface.signatureId && signature && signature !== surface.signatureId) {
        return false;
    }
    const methodName = safeInvokeMethodName(invokeExpr);
    const expectedName = surface.methodName || surface.functionName;
    if (expectedName && methodName !== expectedName) {
        return false;
    }
    if (surface.ownerName) {
        const ownerName = safeInvokeOwnerName(invokeExpr);
        if (ownerName && ownerName !== surface.ownerName) {
            return false;
        }
    }
    return !!expectedName;
}

function resolveCallbackMethodsFromLocator(
    scene: Scene,
    invokeExpr: any,
    locator: CallbackLocator,
): ArkMethod[] {
    const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
    if (locator.kind === "arg") {
        const value = args[locator.index];
        return value ? resolveCallbackMethodsFromValueWithReturns(scene, value, { maxDepth: 4 }) : [];
    }
    const baseValues = resolveEndpointValues(scene, args, locator.base);
    if (locator.accessPath.length === 0) {
        return [];
    }
    let ownerValues = baseValues;
    for (const segment of locator.accessPath.slice(0, -1)) {
        ownerValues = ownerValues.flatMap(value => resolveAnonymousObjectFieldValues(scene, value, segment));
    }
    const callbackFieldName = locator.accessPath[locator.accessPath.length - 1];
    const out = new Map<string, ArkMethod>();
    for (const value of ownerValues) {
        for (const method of resolveMethodsFromAnonymousObjectCarrierByField(scene, value, callbackFieldName, {
            maxCandidates: 16,
            enableLocalBacktrace: true,
            maxBacktraceSteps: 6,
            maxVisitedDefs: 24,
        })) {
            const signature = method?.getSignature?.()?.toString?.();
            if (!signature || out.has(signature)) continue;
            out.set(signature, method);
        }
    }
    return [...out.values()];
}

function resolveEndpointValues(scene: Scene, args: any[], endpoint: AssetEndpoint): any[] {
    if (endpoint.base.kind !== "arg") {
        return [];
    }
    const value = args[endpoint.base.index];
    if (!value) {
        return [];
    }
    let values = [value];
    for (const segment of endpoint.accessPath || []) {
        values = values.flatMap(item => resolveAnonymousObjectFieldValues(scene, item, segment));
    }
    return values;
}

function resolveAnonymousObjectFieldValues(scene: Scene, objectValue: any, fieldName: string): any[] {
    const classSignature = String(objectValue?.getType?.()?.getClassSignature?.()?.toString?.() || "");
    if (!classSignature) return [];
    const out: any[] = [];
    const seen = new Set<string>();
    for (const method of scene.getMethods()) {
        const ownerSignature = String(method?.getDeclaringArkClass?.()?.getSignature?.()?.toString?.() || "");
        if (ownerSignature !== classSignature) continue;
        const methodName = String(method?.getName?.() || "");
        if (!(methodName.includes("constructor(") || methodName.includes("%instInit"))) continue;
        const cfg = method?.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts?.() || []) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const left: any = stmt.getLeftOp();
            const base = left?.getBase?.();
            const assignedFieldName = left?.getFieldSignature?.()?.getFieldName?.() || "";
            if (base?.getName?.() !== "this" || assignedFieldName !== fieldName) continue;
            const right: any = stmt.getRightOp();
            const key = String(right?.toString?.() || right?.getName?.() || "");
            if (!right || seen.has(key)) continue;
            seen.add(key);
            out.push(right);
        }
    }
    return out;
}

function callbackLocatorArgIndex(locator: CallbackLocator): number {
    if (locator.kind === "arg") {
        return locator.index;
    }
    return locator.base.base.kind === "arg" ? locator.base.base.index : 0;
}

function callbackLocatorKey(locator: CallbackLocator): string {
    if (locator.kind === "arg") {
        return `arg${locator.index}`;
    }
    const base = locator.base.base.kind === "arg" ? `arg${locator.base.base.index}` : locator.base.base.kind;
    const pathText = locator.accessPath.length > 0 ? `.${locator.accessPath.join(".")}` : "";
    return `${base}${pathText}`;
}

function safeInvokeSignature(invokeExpr: any): string {
    return invokeExpr?.getMethodSignature?.()?.toString?.() || "";
}

function safeInvokeMethodName(invokeExpr: any): string {
    const signature = invokeExpr?.getMethodSignature?.();
    const direct = signature?.getMethodSubSignature?.()?.getMethodName?.();
    if (direct) return String(direct);
    const text = signature?.toString?.() || "";
    const match = /\.([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/.exec(text);
    return match?.[1] || "";
}

function safeInvokeOwnerName(invokeExpr: any): string {
    return invokeExpr?.getMethodSignature?.()?.getDeclaringClassSignature?.()?.getClassName?.() || "";
}

function findEntryMethod(scene: Scene, ownerName: string, methodName: string): ArkMethod | undefined {
    return scene.getMethods().find(method =>
        method.getName?.() === methodName
        && method.getDeclaringArkClass?.()?.getName?.() === ownerName
    );
}

function normalizePhase(value: string): ArkMainPhaseName {
    switch (value) {
        case "bootstrap":
        case "composition":
        case "interaction":
        case "reactive_handoff":
        case "teardown":
            return value;
        default:
            return "composition";
    }
}

function normalizeFactKind(value: string): ArkMainFactKind {
    switch (value) {
        case "ability_lifecycle":
        case "stage_lifecycle":
        case "extension_lifecycle":
        case "page_build":
        case "page_lifecycle":
        case "callback":
        case "scheduler_callback":
        case "watch_handler":
        case "watch_source":
        case "want_handoff":
        case "router_source":
        case "router_trigger":
            return value;
        default:
            return "page_build";
    }
}

function normalizeOwnerKind(value: EntrySurface["ownerKind"]): ArkMainOwnerKind {
    switch (value) {
        case "ability":
            return "ability_owner";
        case "extension":
            return "extension_owner";
        case "component":
        case "page":
            return "component_owner";
        default:
            return "unknown_owner";
    }
}

function pushWarning(warnings: string[], onWarning: ((warning: string) => void) | undefined, warning: string): void {
    warnings.push(warning);
    onWarning?.(warning);
}
