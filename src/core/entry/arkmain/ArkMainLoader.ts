import * as fs from "fs";
import * as path from "path";
import type { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { ArkAssignStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkStaticInvokeExpr } from "../../../../arkanalyzer/out/src/core/base/Expr";
import type { ArkMethod } from "../../../../arkanalyzer/out/src/core/model/ArkMethod";
import {
    isAnalysisLoadableAssetStatus,
    validateAssetDocument,
    type AnalysisAssetLoadMode,
    type AssetBinding,
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
import type { ArkanalyzerMethodKey } from "../../api/identity";
import {
    isResolvedEndpointRuntimeValueProjection,
    projectEndpointRuntimeValues,
    type EndpointRuntimeValueProjection,
} from "../../api/effects/EndpointAccessPathProjector";
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
    endpointProjectionLedger: ArkMainEndpointProjectionLedgerItem[];
    loadedFiles: string[];
    warnings: string[];
    discoveredArkMainProjects: string[];
    enabledArkMainProjects: string[];
}

export interface ArkMainEndpointProjectionLedgerItem {
    consumer: "arkmain";
    consumerStatus: "consumable" | "blocked";
    assetId: string;
    canonicalApiId: string;
    semanticSurfaceId?: string;
    semanticBindingId?: string;
    semanticTemplateId?: string;
    callbackLocator: string;
    endpointSpec: AssetEndpoint;
    endpointPath: string;
    endpointBaseKind: string;
    status: EndpointRuntimeValueProjection["status"];
    reason: string;
    diagnosticKind?: EndpointRuntimeValueProjection["diagnosticKind"];
    valueKind: EndpointRuntimeValueProjection["valueKind"];
    valueCount: number;
    failureCategory?: EndpointRuntimeValueProjection["failureCategory"];
    fieldPath?: string[];
    diagnosticDetails?: Record<string, unknown>;
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
    const endpointProjectionLedger: ArkMainEndpointProjectionLedgerItem[] = [];
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
            endpointProjectionLedger.push(...loadResult.endpointProjectionLedger);
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
        endpointProjectionLedger,
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
    endpointProjectionLedger: ArkMainEndpointProjectionLedgerItem[];
}

type ArkMainSemanticSurface = EntrySurface | InvokeSurface;

interface AcceptedArkMainSemanticSurface {
    surface: ArkMainSemanticSurface;
    canonicalApiId: string;
    methodKey: ArkanalyzerMethodKey;
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
    const endpointProjectionLedger: ArkMainEndpointProjectionLedgerItem[] = [];
    const lifecycleSurfacesById = new Map(
        (asset.surfaces || [])
            .filter((surface): surface is ArkMainSemanticSurface => surface.kind === "entry" || surface.kind === "invoke")
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
                const gate = acceptArkMainSemanticSurface(
                    asset.id,
                    binding,
                    lifecycleSurfacesById.get(binding.surfaceId),
                    lifecycleTemplate.id,
                    "entry.lifecycle",
                    warnings,
                    onWarning,
                );
                if (!gate) continue;
                const phase = parsePhase(lifecycleTemplate.phase);
                const kind = parseFactKind(lifecycleTemplate.entryKind);
                const ownerKind = parseOwnerKind(lifecycleTemplate.ownerKind);
                const entryShape = stableString(lifecycleTemplate.entryShape);
                if (!phase || !kind || !ownerKind || !entryShape) {
                    pushWarning(
                        warnings,
                        onWarning,
                        `arkmain asset ${asset.id} entry ${gate.canonicalApiId} has unsupported lifecycle semantics`,
                    );
                    continue;
                }
                const method = findEntryMethod(scene, gate.methodKey);
                if (!method) {
                    pushWarning(
                        warnings,
                        onWarning,
                        `arkmain asset ${asset.id} entry ${gate.canonicalApiId} did not match a scene method`,
                    );
                    continue;
                }
                facts.push({
                    phase,
                    kind,
                    method,
                    ownerKind,
                    reason: `Project arkmain asset ${asset.id} selected ${gate.canonicalApiId}`,
                    canonicalApiId: gate.canonicalApiId,
                    semanticSurfaceId: gate.surface.surfaceId,
                    semanticBindingId: binding.bindingId,
                    semanticTemplateId: lifecycleTemplate.id,
                    semanticGate: "exact_arkanalyzer_method_key",
                    entryFamily: binding.semanticsFamily || lifecycleTemplate.entryKind,
                    entryShape,
                    recognitionLayer: "project_arkmain_asset",
                });
                continue;
            }

            const callbackTemplate = callbackRegisterTemplatesById.get(ref);
            if (callbackTemplate) {
                const gate = acceptArkMainSemanticSurface(
                    asset.id,
                    binding,
                    invokeSurfacesById.get(binding.surfaceId),
                    callbackTemplate.id,
                    "entry.callbackRegister",
                    warnings,
                    onWarning,
                );
                if (!gate) continue;
                facts.push(...lowerCallbackRegisterTemplate(
                    scene,
                    asset.id,
                    binding,
                    gate,
                    binding.semanticsFamily,
                    callbackTemplate,
                    endpointProjectionLedger,
                    warnings,
                    onWarning,
                ));
            }
        }
    }

    return { facts, endpointProjectionLedger };
}

function lowerCallbackRegisterTemplate(
    scene: Scene,
    assetId: string,
    binding: AssetBinding,
    gate: AcceptedArkMainSemanticSurface,
    semanticsFamily: string | undefined,
    template: EntryCallbackRegisterTemplate,
    endpointProjectionLedger: ArkMainEndpointProjectionLedgerItem[],
    warnings: string[],
    onWarning?: (warning: string) => void,
): ArkMainEntryFact[] {
    const out: ArkMainEntryFact[] = [];
    const seen = new Set<string>();
    const callbackEntryFamily = stableString(semanticsFamily) || stableString(template.callbackRole);
    if (!callbackEntryFamily) {
        pushWarning(
            warnings,
            onWarning,
            `arkmain asset ${assetId} callbackRegister ${gate.canonicalApiId} is missing callback semantic family`,
        );
        return out;
    }
    for (const sourceMethod of scene.getMethods()) {
        const cfg = sourceMethod.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts?.() || []) {
            const invokeExpr = stmt?.getInvokeExpr?.();
            if (!invokeExpr || !matchesInvokeSurface(invokeExpr, gate.methodKey)) {
                continue;
            }
            const callbackResolution = resolveCallbackMethodsFromLocator(scene, stmt, invokeExpr, template.callback);
            if (callbackResolution.projection) {
                endpointProjectionLedger.push(createArkMainEndpointProjectionLedgerItem(
                    assetId,
                    binding,
                    gate,
                    template,
                    callbackResolution.callbackLocatorKey,
                    callbackResolution.projection,
                ));
            }
            if (callbackResolution.blockedReason) {
                pushWarning(
                    warnings,
                    onWarning,
                    `arkmain asset ${assetId} callbackRegister ${gate.canonicalApiId} blocked callback endpoint ${callbackResolution.callbackLocatorKey}: ${callbackResolution.blockedReason}`,
                );
                continue;
            }
            const callbackMethods = callbackResolution.methods;
            const registrationSignature = safeInvokeSignature(invokeExpr);
            if (!registrationSignature) {
                pushWarning(
                    warnings,
                    onWarning,
                    `arkmain asset ${assetId} callbackRegister ${gate.canonicalApiId} matched without stable registration signature`,
                );
                continue;
            }
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
                    canonicalApiId: gate.canonicalApiId,
                    semanticSurfaceId: gate.surface.surfaceId,
                    semanticBindingId: binding.bindingId,
                    semanticTemplateId: template.id,
                    semanticGate: "exact_arkanalyzer_method_key",
                    sourceMethod,
                    callbackFlavor: "ui_event",
                    callbackShape: template.callback.kind === "option" ? "options_object_slot" : "direct_callback_slot",
                    callbackSlotFamily: template.callback.kind === "option" ? "project_component_option_slot" : "ui_direct_slot",
                    callbackRecognitionLayer: "component_options",
                    callbackRegistrationSignature: registrationSignature,
                    callbackArgIndex: callbackLocatorArgIndex(template.callback),
                    entryFamily: callbackEntryFamily,
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
            `arkmain asset ${assetId} callbackRegister ${gate.canonicalApiId} did not match a scene callback`,
        );
    }
    return out;
}

function acceptArkMainSemanticSurface(
    assetId: string,
    binding: AssetBinding,
    surface: ArkMainSemanticSurface | undefined,
    templateId: string,
    effectKind: string,
    warnings: string[],
    onWarning?: (warning: string) => void,
): AcceptedArkMainSemanticSurface | undefined {
    const bindingId = stableString(binding.bindingId) || "<missing bindingId>";
    if (!surface) {
        pushWarning(
            warnings,
            onWarning,
            `arkmain asset ${assetId} ${effectKind} binding ${bindingId} references missing surface ${String(binding.surfaceId || "<missing surfaceId>")}`,
        );
        return undefined;
    }
    const bindingCanonicalApiId = stableString(binding.canonicalApiId);
    const surfaceCanonicalApiId = stableString(surface.canonicalApiId);
    if (!bindingCanonicalApiId) {
        pushWarning(
            warnings,
            onWarning,
            `arkmain asset ${assetId} ${effectKind} binding ${bindingId} template ${templateId} is missing canonicalApiId`,
        );
        return undefined;
    }
    if (!surfaceCanonicalApiId) {
        pushWarning(
            warnings,
            onWarning,
            `arkmain asset ${assetId} ${effectKind} surface ${surface.surfaceId} template ${templateId} is missing canonicalApiId`,
        );
        return undefined;
    }
    if (bindingCanonicalApiId !== surfaceCanonicalApiId) {
        pushWarning(
            warnings,
            onWarning,
            `arkmain asset ${assetId} ${effectKind} binding ${bindingId} template ${templateId} canonicalApiId does not match surface canonicalApiId`,
        );
        return undefined;
    }
    const methodKey = arkanalyzerMethodKeyFromSurface(surface);
    if (!methodKey) {
        pushWarning(
            warnings,
            onWarning,
            `arkmain asset ${assetId} ${effectKind} ${surfaceCanonicalApiId} is missing exact Arkanalyzer methodKey evidence`,
        );
        return undefined;
    }
    return { surface, canonicalApiId: surfaceCanonicalApiId, methodKey };
}

function matchesInvokeSurface(invokeExpr: any, expected: ArkanalyzerMethodKey): boolean {
    const actual = arkanalyzerMethodKeyFromInvoke(invokeExpr);
    return !!actual && sameArkanalyzerMethodKey(expected, actual);
}

interface ArkMainCallbackMethodResolution {
    methods: ArkMethod[];
    callbackLocatorKey: string;
    projection?: EndpointRuntimeValueProjection;
    blockedReason?: string;
}

function resolveCallbackMethodsFromLocator(
    scene: Scene,
    stmt: any,
    invokeExpr: any,
    locator: CallbackLocator,
): ArkMainCallbackMethodResolution {
    const locatorKey = callbackLocatorKey(locator);
    if (locator.kind === "arg") {
        const projection = projectArkMainEndpointValues(scene, stmt, invokeExpr, { base: { kind: "arg", index: locator.index } });
        if (!isResolvedEndpointRuntimeValueProjection(projection)) {
            return {
                methods: [],
                callbackLocatorKey: locatorKey,
                projection,
                blockedReason: `${projection.status}:${projection.reason}`,
            };
        }
        return {
            methods: projection.values.flatMap(value =>
                resolveCallbackMethodsFromValueWithReturns(scene, value, { maxDepth: 4 }),
            ),
            callbackLocatorKey: locatorKey,
            projection,
        };
    }
    if (locator.accessPath.length === 0) {
        return {
            methods: [],
            callbackLocatorKey: locatorKey,
            blockedReason: "asset_endpoint_error:callback_option_access_path_missing",
        };
    }
    const ownerEndpoint = extendAssetEndpointAccessPath(locator.base, locator.accessPath.slice(0, -1));
    const projection = projectArkMainEndpointValues(scene, stmt, invokeExpr, ownerEndpoint);
    if (!isResolvedEndpointRuntimeValueProjection(projection)) {
        return {
            methods: [],
            callbackLocatorKey: locatorKey,
            projection,
            blockedReason: `${projection.status}:${projection.reason}`,
        };
    }
    const callbackFieldName = locator.accessPath[locator.accessPath.length - 1];
    const out = new Map<string, ArkMethod>();
    for (const value of projection.values) {
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
    return {
        methods: [...out.values()],
        callbackLocatorKey: locatorKey,
        projection,
    };
}

function projectArkMainEndpointValues(
    scene: Scene,
    stmt: any,
    invokeExpr: any,
    endpoint: AssetEndpoint,
): EndpointRuntimeValueProjection {
    return projectEndpointRuntimeValues({
        endpoint,
        stmt,
        invokeExpr,
        resolveAccessPathValues(values, accessPath) {
            return resolveArkMainAccessPathValues(scene, values, accessPath);
        },
    });
}

function resolveArkMainAccessPathValues(
    scene: Scene,
    values: readonly any[],
    accessPath: readonly string[],
): any[] {
    let current = values.filter(value => value !== undefined && value !== null);
    for (const segment of accessPath) {
        current = current.flatMap(value => resolveAnonymousObjectFieldValues(scene, value, segment));
        if (current.length === 0) break;
    }
    return current;
}

function extendAssetEndpointAccessPath(endpoint: AssetEndpoint, suffix: readonly string[]): AssetEndpoint {
    const accessPath = [
        ...(endpoint.accessPath || []),
        ...suffix,
    ].map(segment => String(segment || "").trim()).filter(Boolean);
    const out: AssetEndpoint = {
        base: cloneEndpointBase(endpoint.base),
    };
    if (accessPath.length > 0) out.accessPath = accessPath;
    if (endpoint.taintScope) out.taintScope = endpoint.taintScope;
    return out;
}

function cloneEndpointBase(base: AssetEndpoint["base"]): AssetEndpoint["base"] {
    switch (base.kind) {
        case "receiver":
            return { kind: "receiver" };
        case "arg":
            return { kind: "arg", index: base.index };
        case "rest":
            return { kind: "rest", startIndex: base.startIndex };
        case "return":
            return { kind: "return" };
        case "callbackArg":
            return {
                kind: "callbackArg",
                callback: cloneCallbackLocator(base.callback),
                argIndex: base.argIndex,
            };
        case "callbackReturn":
            return {
                kind: "callbackReturn",
                callback: cloneCallbackLocator(base.callback),
            };
        case "promiseResult":
            return { kind: "promiseResult" };
        case "promiseRejected":
            return { kind: "promiseRejected" };
        case "constructorResult":
            return { kind: "constructorResult" };
    }
}

function cloneCallbackLocator(locator: CallbackLocator): CallbackLocator {
    if (locator.kind === "arg") return { kind: "arg", index: locator.index };
    return {
        kind: "option",
        base: extendAssetEndpointAccessPath(locator.base, []),
        accessPath: locator.accessPath.map(segment => String(segment || "").trim()).filter(Boolean),
    };
}

function createArkMainEndpointProjectionLedgerItem(
    assetId: string,
    binding: AssetBinding,
    gate: AcceptedArkMainSemanticSurface,
    template: EntryCallbackRegisterTemplate,
    locatorKey: string,
    projection: EndpointRuntimeValueProjection,
): ArkMainEndpointProjectionLedgerItem {
    const item: ArkMainEndpointProjectionLedgerItem = {
        consumer: "arkmain",
        consumerStatus: isResolvedEndpointRuntimeValueProjection(projection) ? "consumable" : "blocked",
        assetId,
        canonicalApiId: gate.canonicalApiId,
        semanticSurfaceId: gate.surface.surfaceId,
        semanticBindingId: binding.bindingId,
        semanticTemplateId: template.id,
        callbackLocator: locatorKey,
        endpointSpec: projection.endpointSpec,
        endpointPath: projection.endpointPath,
        endpointBaseKind: projection.endpointBaseKind,
        status: projection.status,
        reason: projection.reason,
        diagnosticKind: projection.diagnosticKind,
        valueKind: projection.valueKind,
        valueCount: projection.values.length,
        failureCategory: projection.failureCategory,
        fieldPath: projection.fieldPath ? [...projection.fieldPath] : undefined,
        diagnosticDetails: projection.diagnosticDetails ? { ...projection.diagnosticDetails } : undefined,
    };
    if (!item.semanticSurfaceId) delete item.semanticSurfaceId;
    if (!item.semanticBindingId) delete item.semanticBindingId;
    if (!item.semanticTemplateId) delete item.semanticTemplateId;
    if (!item.diagnosticKind) delete item.diagnosticKind;
    if (!item.failureCategory || item.failureCategory === "none") delete item.failureCategory;
    if (!item.fieldPath || item.fieldPath.length === 0) delete item.fieldPath;
    if (!item.diagnosticDetails || Object.keys(item.diagnosticDetails).length === 0) delete item.diagnosticDetails;
    return item;
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

function findEntryMethod(scene: Scene, expected: ArkanalyzerMethodKey): ArkMethod | undefined {
    return scene.getMethods().find(method => {
        const actual = arkanalyzerMethodKeyFromMethod(method);
        return !!actual && sameArkanalyzerMethodKey(expected, actual);
    });
}

function arkanalyzerMethodKeyFromSurface(surface: InvokeSurface | EntrySurface): ArkanalyzerMethodKey | undefined {
    const methodKey = (surface as any).evidence?.arkanalyzer?.methodKey;
    if (!methodKey || typeof methodKey !== "object" || Array.isArray(methodKey)) return undefined;
    const out: ArkanalyzerMethodKey = {
        declaringFileName: String((methodKey as any).declaringFileName || "").trim(),
        declaringNamespacePath: Array.isArray((methodKey as any).declaringNamespacePath)
            ? (methodKey as any).declaringNamespacePath.map((item: unknown) => String(item || "").trim()).filter(Boolean)
            : [],
        declaringClassName: String((methodKey as any).declaringClassName || "").trim(),
        methodName: String((methodKey as any).methodName || "").trim(),
        parameterTypes: Array.isArray((methodKey as any).parameterTypes)
            ? (methodKey as any).parameterTypes.map((item: unknown) => String(item || "").trim())
            : [],
        returnType: String((methodKey as any).returnType || "").trim(),
        staticFlag: (methodKey as any).staticFlag === true,
    };
    return isCompleteArkanalyzerMethodKey(out) ? out : undefined;
}

function arkanalyzerMethodKeyFromInvoke(invokeExpr: any): ArkanalyzerMethodKey | undefined {
    const signature = invokeExpr?.getMethodSignature?.();
    if (!signature) return undefined;
    return arkanalyzerMethodKeyFromSignature(signature, invokeExpr instanceof ArkStaticInvokeExpr);
}

function arkanalyzerMethodKeyFromMethod(method: ArkMethod): ArkanalyzerMethodKey | undefined {
    const signature = method.getSignature?.();
    if (!signature) return undefined;
    return arkanalyzerMethodKeyFromSignature(signature, (method as any).isStatic?.() === true);
}

function arkanalyzerMethodKeyFromSignature(signature: any, staticFlag: boolean): ArkanalyzerMethodKey | undefined {
    const declaringClass = signature.getDeclaringClassSignature?.();
    const subSignature = signature.getMethodSubSignature?.();
    const key: ArkanalyzerMethodKey = {
        declaringFileName: String(declaringClass?.getDeclaringFileSignature?.()?.toString?.() || "").trim(),
        declaringNamespacePath: namespacePathFromClassSignature(declaringClass),
        declaringClassName: String(declaringClass?.getClassName?.() || "").trim(),
        methodName: String(subSignature?.getMethodName?.() || "").trim(),
        parameterTypes: (subSignature?.getParameters?.() || []).map((param: any) => typeTextOf(param)),
        returnType: typeTextOf(subSignature?.getReturnType?.()),
        staticFlag,
    };
    return isCompleteArkanalyzerMethodKey(key) ? key : undefined;
}

function sameArkanalyzerMethodKey(left: ArkanalyzerMethodKey, right: ArkanalyzerMethodKey): boolean {
    return left.declaringFileName === right.declaringFileName
        && left.declaringClassName === right.declaringClassName
        && left.methodName === right.methodName
        && left.returnType === right.returnType
        && left.staticFlag === right.staticFlag
        && arrayEquals(left.declaringNamespacePath, right.declaringNamespacePath)
        && arrayEquals(left.parameterTypes, right.parameterTypes);
}

function isCompleteArkanalyzerMethodKey(key: ArkanalyzerMethodKey): boolean {
    return !!key.declaringFileName
        && !!key.declaringClassName
        && !!key.methodName
        && !!key.returnType
        && !containsUnknownIdentityText(key.declaringFileName)
        && !containsUnknownIdentityText(key.declaringClassName)
        && !containsUnknownIdentityText(key.methodName)
        && !containsUnknownIdentityText(key.returnType)
        && key.parameterTypes.every(item => !!item && !containsUnknownIdentityText(item));
}

function namespacePathFromClassSignature(declaringClass: any): string[] {
    const text = String(declaringClass?.getDeclaringNamespaceSignature?.()?.toString?.() || "")
        .replace(/\\/g, "/")
        .replace(/:\s*$/g, "")
        .trim();
    if (!text) return [];
    const colon = text.lastIndexOf(":");
    const namespaceText = (colon >= 0 ? text.slice(colon + 1) : text).trim();
    if (!namespaceText || namespaceText === "%dflt") return [];
    return namespaceText.split(".").map(part => part.trim()).filter(part => part.length > 0 && part !== "%dflt");
}

function typeTextOf(value: any): string {
    return String(value?.getType?.()?.toString?.() || value?.toString?.() || "").trim();
}

function arrayEquals(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((item, index) => item === right[index]);
}

function stableString(value: unknown): string | undefined {
    const text = String(value || "").trim();
    return text.length > 0 ? text : undefined;
}

function containsUnknownIdentityText(value: unknown): boolean {
    const text = String(value || "").trim().toLowerCase();
    return !text || text.includes("%unk") || text.includes("@unk") || text.includes("unknown");
}

function parsePhase(value: string): ArkMainPhaseName | undefined {
    switch (value) {
        case "bootstrap":
        case "composition":
        case "interaction":
        case "reactive_handoff":
        case "teardown":
            return value;
        default:
            return undefined;
    }
}

function parseFactKind(value: string): ArkMainFactKind | undefined {
    switch (value) {
        case "ability_lifecycle":
        case "stage_lifecycle":
        case "extension_lifecycle":
        case "process_lifecycle":
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
            return undefined;
    }
}

function parseOwnerKind(value: string | undefined): ArkMainOwnerKind | undefined {
    switch (value) {
        case "ability":
            return "ability_owner";
        case "stage":
            return "stage_owner";
        case "extension":
            return "extension_owner";
        case "child_process":
        case "child_process_owner":
        case "process":
            return "child_process_owner";
        case "builder":
            return "builder_owner";
        case "component":
        case "page":
            return "component_owner";
        default:
            return undefined;
    }
}

function pushWarning(warnings: string[], onWarning: ((warning: string) => void) | undefined, warning: string): void {
    warnings.push(warning);
    onWarning?.(warning);
}
