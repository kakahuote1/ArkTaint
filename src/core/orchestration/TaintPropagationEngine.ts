import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { PointerAnalysis } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/PointerAnalysis";
import { PointerAnalysisConfig } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/PointerAnalysisConfig";
import { Pag, PagNode } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { CallGraph } from "../../../arkanalyzer/out/src/callgraph/model/CallGraph";
import { CallGraphBuilder } from "../../../arkanalyzer/out/src/callgraph/model/builder/CallGraphBuilder";
import { ArkAssignStmt } from "../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkMethod } from "../../../arkanalyzer/out/src/core/model/ArkMethod";
import { TaintFact } from "../kernel/model/TaintFact";
import { TaintFlow } from "../kernel/model/TaintFlow";
import { TaintTracker } from "../kernel/model/TaintTracker";
import { TaintContextManager, CallEdgeInfo, CallEdgeType } from "../kernel/context/TaintContext";
import { AdaptiveContextSelector, AdaptiveContextSelectorOptions } from "../kernel/context/AdaptiveContextSelector";
import { buildFieldToVarIndex } from "../kernel/builders/FieldIndexBuilder";
import {
    buildCallEdgeMap,
    buildCaptureEdgeMap,
    buildCaptureLazyMaterializer,
    buildReceiverFieldBridgeMap,
    CaptureEdgeInfo,
    CaptureLazyMaterializer,
    materializeCaptureSitesForNode,
    ReceiverFieldBridgeInfo,
} from "../kernel/builders/CallEdgeMapBuilder";
import {
    buildSyntheticInvokeEdges,
    buildSyntheticInvokeLazyMaterializer,
    buildSyntheticConstructorStoreMap,
    buildSyntheticFieldBridgeMap,
    buildSyntheticStaticInitStoreMap,
    materializeEagerSyntheticInvokeSites,
    materializeSyntheticInvokeSitesForNode,
    materializeSyntheticInvokeSitesForCaller,
    materializeAllSyntheticInvokeSites,
    EXCLUDE_ALL_DEFERRED_SYNTHETIC_INVOKE_SITES,
    SyntheticInvokeEdgeInfo,
    SyntheticConstructorStoreInfo,
    SyntheticFieldBridgeInfo,
    SyntheticStaticInitStoreInfo,
    SyntheticInvokeLazyMaterializer,
    type CallEdgeMaterializationLedgerRecord,
} from "../kernel/builders/SyntheticInvokeEdgeBuilder";
import {
    FactRuleChain,
    WorklistBudgetTruncation,
    WorklistSolver,
    WorklistSolverDeps,
} from "../kernel/propagation/WorklistSolver";
import {
    createEmptySinkDetectProfile,
    detectSinkEffects as runSinkDetector,
    mergeSinkDetectProfiles,
    SinkDetectAuditEntry,
    SinkDetectProfile,
} from "../kernel/rules/SinkDetector";
import {
    collectSourceRuleSeeds as collectSourceRuleSeedsFromRules,
    SourceRuleSeedAuditEntry,
    SourceRuleZeroHitAuditEntry,
} from "../kernel/rules/SourceRuleSeedCollector";
import { createDebugCollectors, dumpDebugArtifactsToDir } from "../kernel/debug/DebugArtifactUtils";
import { WorklistProfiler, WorklistProfileSnapshot } from "../kernel/debug/WorklistProfiler";
import { TraceGraph, TraceGraphRecorder } from "../trace/TraceGraph";
import {
    expandEntryMethodsByDirectCalls,
    collectDirectCallExpansionTargetMethods,
    collectKeyedDispatchCallbackMethods,
} from "../entry/shared/ExplicitEntryScopeResolver";
import {
    buildMethodThisOwnerContextIndex,
    collectParameterAssignStmts,
    isCallableValue,
    resolveCalleeCandidates,
    resolveMethodsFromCallable,
} from "../substrate/queries/CalleeResolver";
import { resolveCallbackRegistrationsFromStmt } from "../substrate/queries/CallbackBindingQuery";
import { collectFiniteStringCandidatesFromValue } from "../substrate/queries/FiniteStringCandidateResolver";
import {
    isKnownFrameworkCallbackMethodName,
    resolveKnownControllerOptionCallbackRegistrationsFromStmt,
    resolveKnownFrameworkCallbackRegistration,
} from "../entry/shared/FrameworkCallbackClassifier";
import { collectOrdinaryHigherOrderCallbackMethodSignaturesFromMethod } from "../kernel/ordinary/OrdinaryArrayPropagation";
import { buildOrdinarySharedStateIndex } from "../kernel/ordinary/OrdinarySharedStatePropagation";
import { buildArkMainPlan } from "../entry/arkmain/ArkMainPlanner";
import { ArkMainEntryFact } from "../entry/arkmain/ArkMainTypes";
import { ArkMainSyntheticRootBuilder } from "../entry/arkmain/ArkMainSyntheticRootBuilder";
import { buildComponentEntrypointExpansionIndex } from "../entry/arkmain/facts/ArkMainComponentInstantiationResolver";
import {
    emptyModuleAuditSnapshot,
    ModuleAuditSnapshot,
    ModuleRuntime,
    TaintModule,
} from "../kernel/contracts/ModuleContract";
import type { InternalModuleQueryApi } from "../kernel/contracts/ModuleInternal";
import {
    emptyPagNodeResolutionAuditSnapshot,
    getPagNodeResolutionAuditSnapshot,
    PagNodeResolutionAuditSnapshot,
    resetPagNodeResolutionAudit,
} from "../kernel/contracts/PagNodeResolution";
import {
    ExecutionHandoffContractSnapshot,
    ExecutionHandoffContractSnapshotItem,
} from "../kernel/handoff/ExecutionHandoffContract";
import {
    buildExecutionHandoffContracts,
    buildExecutionHandoffSnapshot,
} from "../kernel/handoff/ExecutionHandoffInference";
import { buildExecutionHandoffSyntheticInvokeEdges } from "../kernel/handoff/ExecutionHandoffEdgeEmitter";
import {
    buildExecutionHandoffSiteKeyFromRecord,
} from "../kernel/handoff/ExecutionHandoffSiteKey";
import { loadModules } from "./modules/ModuleLoader";
import { createModuleRuntime } from "./modules/ModuleRuntime";
import { EnginePlugin } from "./plugins/EnginePlugin";
import { loadEnginePlugins } from "./plugins/EnginePluginLoader";
import {
    ActivePropagationHooks,
    createEnginePluginRuntime,
    EnginePluginAuditSnapshot,
    EnginePluginRuntime,
} from "./plugins/EnginePluginRuntime";
import {
    AssetDocumentBase,
    AssetIdentityIndex,
    createAssetIdentityIndex,
} from "../assets/schema";
import { extendCanonicalApiRegistryWithAssetDeclarations } from "../assets/registry/AssetDeclaredCanonicalApiRegistry";
import {
    ApiEffectRuntimeIndex,
    cloneEndpointResolutionLedgerItem,
    summarizeSemanticEffectLedger,
    type EndpointResolutionLedgerItem,
    type EndpointResolutionStatus,
    type SemanticEffectLedgerRecord,
    type SemanticEffectLedgerSummary,
} from "../api/effects";
import type { SemanticEffectSite } from "../api/effects/SemanticEffectSite";
import {
    emptyOfficialOccurrenceCoverageSnapshot,
    type OfficialOccurrenceCoverageSnapshot,
    type OfficialOccurrenceRecord,
} from "../api/occurrence";
import {
    createDefaultCanonicalApiRegistry,
    mergeCanonicalApiRegistries,
    type CanonicalApiRegistry,
} from "../api/identity";
import { hasApiEffectIdentity } from "../api/ApiOccurrenceIdentity";
import {
    BaseRule,
    RuleEndpoint,
    RuleEndpointOrRef,
    RuleEndpointTaintScope,
    SanitizerRule,
    SinkRule,
    SourceRule,
    TransferRule,
    normalizeEndpoint,
} from "../rules/RuleSchema";
import { normalizeRuleFamily } from "../rules/RuleFamily";
import {
    orderRulesByFamilyAndId,
} from "../rules/RuleOrdering";
import { extractFilePathFromSignature } from "./postsolve/PostsolveSharedEvidence";
import {
    PostsolveContext,
    PostsolveFlowResult,
} from "./postsolve/PostsolveTypes";
import {
    MaterializedTaintFlow,
    PathMaterializationOptions,
} from "../provenance/ProvenancePathTypes";
import { FactPredecessorRecord } from "../kernel/propagation/PropagationTypes";
import { buildClassSignatureIndex } from "../kernel/propagation/WorklistReachabilitySupport";
import { materializeTaintFlowPaths } from "../provenance/ProvenancePathRecorder";
import { currentnessEvidenceFromCertificate } from "../provenance/CurrentnessEvidenceAdapter";
import { CurrentnessEvidence } from "../provenance/ProvenancePathTypes";
import { evaluatePostsolveFlow, materializePostsolveFlowResult } from "./postsolve/PostsolveEvaluator";
import { runWorklistSolvingStage } from "./full_analysis/FullAnalysisStages";
import { assertBuildStageBudget, BuildStageBudget } from "../shared/BuildStageBudget";

export interface DebugOptions {
    enableWorklistProfile?: boolean;
    enableTraceGraph?: boolean;
    traceRun?: ConstructorParameters<typeof TraceGraphRecorder>[0]["run"];
    worklistMaxDequeues?: number;
    worklistMaxVisited?: number;
    worklistMaxElapsedMs?: number;
    moduleSetupMaxElapsedMs?: number;
    executionHandoffMaxElapsedMs?: number;
    pagIndexMaxElapsedMs?: number;
    lazyMaterializerMaxElapsedMs?: number;
    reachableMaxElapsedMs?: number;
}

export interface ArkMainSeedOptions {
    methods: ArkMethod[];
    facts: ArkMainEntryFact[];
}

export interface ArkMainSeedReport {
    enabled: boolean;
    methodCount: number;
    factCount: number;
}

export interface TaintEngineOptions {
    contextStrategy?: "fixed" | "adaptive";
    executionHandoff?: "enabled" | "disabled";
    currentness?: "enabled" | "disabled";
    provenanceRecording?: "enabled" | "disabled";
    factIdTracking?: "enabled" | "disabled";
    flowRuleChainTracking?: "enabled" | "disabled";
    progressOutput?: "enabled" | "disabled";
    arkMainEntryClosure?: "full" | "scheduledOnly";
    reachabilityDirectExpansion?: "enabled" | "disabled";
    receiverFieldBridgeMap?: "enabled" | "disabled";
    syntheticInvokeMaterialization?: "enabled" | "disabled";
    semanticAssetReachabilityScope?: "reachable" | "allExactSites";
    adaptiveContext?: AdaptiveContextSelectorOptions;
    transferRules?: TransferRule[];
    apiAssets?: AssetDocumentBase[];
    assetIdentityIndex?: AssetIdentityIndex;
    canonicalApiRegistry?: CanonicalApiRegistry;
    modules?: TaintModule[];
    moduleRoots?: string[];
    moduleFiles?: string[];
    semanticflowEvaluationModelRoots?: string[];
    includeBuiltinModules?: boolean;
    enabledModuleProjects?: string[];
    disabledModuleProjects?: string[];
    disabledModuleIds?: string[];
    disabledAutoSourceRuleIdPrefixes?: string[];
    enginePlugins?: EnginePlugin[];
    enginePluginDirs?: string[];
    enginePluginFiles?: string[];
    includeBuiltinEnginePlugins?: boolean;
    disabledEnginePluginNames?: string[];
    pluginDryRun?: boolean;
    pluginIsolate?: string[];
    pluginAudit?: boolean;
    arkMainSeeds?: ArkMainSeedOptions;
    debug?: DebugOptions;
}

interface SourceRuleSeedCollectionAggregate {
    facts: TaintFact[];
    seededLocals: string[];
    sourceRuleHits: Record<string, number>;
    activatedMethodSignatures: string[];
    sourceSeedAudit: SourceRuleSeedAuditEntry[];
    sourceRuleZeroHitAudit: SourceRuleZeroHitAuditEntry[];
    passCount: number;
    endpointResolutionAudit: EndpointResolutionLedgerItem[];
}

export interface BuildPAGOptions {
    syntheticEntryMethods?: ArkMethod[];
    entryModel?: "arkMain" | "explicit";
}

type EntryModel = "arkMain" | "explicit";

interface SyntheticRootDescriptor {
    fileName: string;
    className: string;
    methodName: string;
}

const SYNTHETIC_ROOTS: Record<EntryModel, SyntheticRootDescriptor> = {
    arkMain: {
        fileName: "@arkMainFile",
        className: "@arkMainClass",
        methodName: "@arkMain",
    },
    explicit: {
        fileName: "@explicitEntryFile",
        className: "@explicitEntryClass",
        methodName: "@explicitEntry",
    },
};

function mergeAssetDocumentsById(assets: AssetDocumentBase[]): AssetDocumentBase[] {
    const byId = new Map<string, AssetDocumentBase>();
    for (const asset of assets) {
        if (!asset?.id || byId.has(asset.id)) continue;
        byId.set(asset.id, asset);
    }
    return [...byId.values()];
}

function buildEffectiveAssetIdentityIndex(
    assets: AssetDocumentBase[],
    canonicalApiRegistry: CanonicalApiRegistry,
): AssetIdentityIndex {
    const index = createAssetIdentityIndex({
        canonicalApiRegistry,
    });
    for (const asset of assets) {
        index.addAsset(asset);
    }
    const conflicts = index.listConflicts();
    if (conflicts.length > 0) {
        throw new Error(`asset identity conflicts: ${conflicts.map(item => item.message).join("; ")}`);
    }
    const unmigrated = index.listUnmigratedAssets();
    if (unmigrated.length > 0) {
        throw new Error(`unmigrated asset identities: ${unmigrated.map(item => `${item.assetId}:${item.reason}`).join("; ")}`);
    }
    return index;
}

function resolveEngineCanonicalApiRegistry(
    options: TaintEngineOptions,
    assets: readonly AssetDocumentBase[],
): CanonicalApiRegistry {
    const baseRegistry = options.canonicalApiRegistry
        ? mergeCanonicalApiRegistries([createDefaultCanonicalApiRegistry(), options.canonicalApiRegistry])
        : createDefaultCanonicalApiRegistry();
    return extendCanonicalApiRegistryWithAssetDeclarations({
        baseRegistry,
        assets,
    });
}

function assertCanonicalApiRegistryCoversAssets(
    assets: readonly AssetDocumentBase[],
    canonicalApiRegistry: CanonicalApiRegistry,
): void {
    const missing: string[] = [];
    for (const asset of assets) {
        for (const surface of asset.surfaces || []) {
            if (surface.canonicalApiId && !canonicalApiRegistry.has(surface.canonicalApiId)) {
                missing.push(`${asset.id}:${surface.canonicalApiId}`);
            }
        }
        for (const binding of asset.bindings || []) {
            if (binding.canonicalApiId && !canonicalApiRegistry.has(binding.canonicalApiId)) {
                missing.push(`${asset.id}:${binding.canonicalApiId}`);
            }
        }
    }
    if (missing.length > 0) {
        throw new Error(`canonical API registry missing asset identities: ${missing.slice(0, 20).join("; ")}${missing.length > 20 ? `; ... ${missing.length - 20} more` : ""}`);
    }
}

export interface RuleHitCounters {
    source: Record<string, number>;
    sink: Record<string, number>;
    transfer: Record<string, number>;
}

export type StageTimingProfile = Record<string, number>;

export interface FlowRuleChain {
    sourceRuleId?: string;
    transferRuleIds: string[];
}

export type DetectProfileSnapshot = SinkDetectProfile;

interface PagBuildCacheEntry {
    pag: Pag;
    cg: CallGraph;
    fieldToVarIndex: Map<string, Set<number>>;
    callEdgeMap: Map<string, CallEdgeInfo>;
    receiverFieldBridgeMap: Map<number, ReceiverFieldBridgeInfo[]>;
    captureEdgeMap: Map<number, CaptureEdgeInfo[]>;
    syntheticInvokeEdgeMap: Map<number, SyntheticInvokeEdgeInfo[]>;
    syntheticConstructorStoreMap: Map<number, SyntheticConstructorStoreInfo[]>;
    syntheticStaticInitStoreMap: Map<number, SyntheticStaticInitStoreInfo[]>;
    syntheticFieldBridgeMap: Map<string, SyntheticFieldBridgeInfo[]>;
    callEdgeMaterializationLedger?: CallEdgeMaterializationLedgerRecord[];
    captureLazyMaterializer?: CaptureLazyMaterializer;
    syntheticInvokeLazyMaterializer?: SyntheticInvokeLazyMaterializer;
    captureEdgeMapReady: boolean;
    syntheticInvokeEdgeMapReady: boolean;
    executionHandoffSnapshot?: ExecutionHandoffContractSnapshot;
    executionHandoffDeferredSiteKeys?: Set<string>;
    executionHandoffEmitEdges?: boolean;
    executionHandoffBindingsKey?: string;
}

export class TaintPropagationEngine {
    private static pagBuildCacheByScene: WeakMap<Scene, Map<string, PagBuildCacheEntry>> = new WeakMap();

    private scene: Scene;
    public pag!: Pag; // Public for test seeding.
    public cg!: CallGraph;
    private tracker: TaintTracker;
    private pta!: PointerAnalysis;

    private fieldToVarIndex: Map<string, Set<number>> = new Map();
    private ctxManager: TaintContextManager;
    private callEdgeMap: Map<string, CallEdgeInfo> = new Map();
    private receiverFieldBridgeMap: Map<number, ReceiverFieldBridgeInfo[]> = new Map();
    private captureEdgeMap: Map<number, CaptureEdgeInfo[]> = new Map();
    private syntheticInvokeEdgeMap: Map<number, SyntheticInvokeEdgeInfo[]> = new Map();
    private syntheticConstructorStoreMap: Map<number, SyntheticConstructorStoreInfo[]> = new Map();
    private syntheticStaticInitStoreMap: Map<number, SyntheticStaticInitStoreInfo[]> = new Map();
    private syntheticFieldBridgeMap: Map<string, SyntheticFieldBridgeInfo[]> = new Map();
    private callEdgeMaterializationLedger: CallEdgeMaterializationLedgerRecord[] = [];
    private captureLazyMaterializer?: CaptureLazyMaterializer;
    private syntheticInvokeLazyMaterializer?: SyntheticInvokeLazyMaterializer;
    private adaptiveContextSelector?: AdaptiveContextSelector;
    private worklistProfiler?: WorklistProfiler;
    private traceGraph?: TraceGraphRecorder;
    private options: TaintEngineOptions;
    private modules: TaintModule[];
    private moduleAssets: AssetDocumentBase[] = [];
    private moduleRuntime?: ModuleRuntime;
    private moduleRuntimeKey?: string;
    private moduleRuntimePag?: Pag;
    private enginePlugins: EnginePlugin[];
    private enginePluginRuntime: EnginePluginRuntime;
    private enginePluginWarnings: string[] = [];
    private observedFacts: Map<string, TaintFact> = new Map();
    private lastEnginePluginFindings: TaintFlow[] = [];
    private ruleHits: {
        source: Map<string, number>;
        sink: Map<string, number>;
        transfer: Map<string, number>;
    } = {
        source: new Map<string, number>(),
        sink: new Map<string, number>(),
        transfer: new Map<string, number>(),
    };
    private factRuleChains: Map<string, FlowRuleChain> = new Map();
    private activeReachableMethodSignatures?: Set<string>;
    private activeOrderedMethodSignatures?: string[];
    private explicitEntryScopeMethodSignatures?: Set<string>;
    private autoEntrySourceRules: SourceRule[] = [];
    private autoAmbientSourceRules: SourceRule[] = [];
    private detectProfile: SinkDetectProfile = createEmptySinkDetectProfile();
    private sinkDetectionAudit: SinkDetectAuditEntry[] = [];
    private sinkDetectionAuditOverflowCount = 0;
    private factPredecessorsByFactId: Map<string, FactPredecessorRecord[]> = new Map();
    private factPredecessorEdgeKeys: Set<string> = new Set();
    private currentnessEvidenceById: Map<string, CurrentnessEvidence> = new Map();
    private lastWorklistTruncation?: WorklistBudgetTruncation;
    private activePagCacheEntry?: PagBuildCacheEntry;
    private interproceduralTaintTargetNodeIdsCache?: Set<number>;
    private classBySignatureCache?: Map<string, any>;
    private methodsBySignatureCache?: Map<string, ArkMethod>;
    private executionHandoffSnapshot?: ExecutionHandoffContractSnapshot;
    private executionHandoffDeferredSiteKeys?: Set<string>;
    private currentEntryModel: EntryModel = "arkMain";
    private arkMainSeedReport?: ArkMainSeedReport;
    private lastPagBuildProfile: StageTimingProfile = {};
    private lastSourceRulePropagationProfile: StageTimingProfile = {};
    private lastReachableProfile: StageTimingProfile = {};
    private apiEffectRuntimeIndex?: ApiEffectRuntimeIndex;
    private assetIdentityIndex?: AssetIdentityIndex;

    public verbose: boolean = true;

    constructor(scene: Scene, k: number = 1, options: TaintEngineOptions = {}) {
        this.scene = scene;
        this.tracker = new TaintTracker({
            trackFactIds: options.factIdTracking !== "disabled",
        });
        this.ctxManager = new TaintContextManager(k);
        this.options = options;
        this.modules = this.initializeModules(options);
        const effectiveAssets = mergeAssetDocumentsById([
            ...(options.apiAssets || []),
            ...this.moduleAssets,
        ]);
        const canonicalApiRegistry = resolveEngineCanonicalApiRegistry(options, effectiveAssets);
        assertCanonicalApiRegistryCoversAssets(effectiveAssets, canonicalApiRegistry);
        const effectiveAssetIdentityIndex = effectiveAssets.length > 0
            ? (options.assetIdentityIndex || buildEffectiveAssetIdentityIndex(effectiveAssets, canonicalApiRegistry))
            : options.assetIdentityIndex;
        this.assetIdentityIndex = effectiveAssetIdentityIndex;
        if (effectiveAssets.length > 0 && effectiveAssetIdentityIndex) {
            this.apiEffectRuntimeIndex = ApiEffectRuntimeIndex.build({
                scene: this.scene,
                assets: effectiveAssets,
                assetIdentityIndex: effectiveAssetIdentityIndex,
                canonicalApiRegistry,
            });
        }
        const enginePluginState = this.initializeEnginePlugins(k, options, this.modules);
        this.enginePlugins = enginePluginState.plugins;
        this.enginePluginWarnings = enginePluginState.warnings;
        this.enginePluginRuntime = enginePluginState.runtime;
        const verboseOverride = this.enginePluginRuntime.getOptionOverrides().get("verbose");
        if (typeof verboseOverride === "boolean") {
            this.verbose = verboseOverride;
        }
    }

    private initializeModules(options: TaintEngineOptions): TaintModule[] {
        const loadedModules = loadModules({
            includeBuiltinModules: options.includeBuiltinModules,
            disabledModuleIds: this.resolveDisabledModuleIds(options),
            moduleRoots: options.moduleRoots,
            moduleFiles: options.moduleFiles,
            semanticflowEvaluationModelRoots: options.semanticflowEvaluationModelRoots,
            modules: options.modules,
            enabledModuleProjects: options.enabledModuleProjects,
            disabledModuleProjects: options.disabledModuleProjects,
            onWarning: (warning) => this.log(`module warning: ${warning}`),
        });
        this.moduleAssets = loadedModules.assets;
        return loadedModules.modules;
    }

    private initializeEnginePlugins(
        k: number,
        options: TaintEngineOptions,
        modules: TaintModule[],
    ): {
        plugins: EnginePlugin[];
        warnings: string[];
        runtime: EnginePluginRuntime;
    } {
        const loadedPlugins = loadEnginePlugins({
            includeBuiltinPlugins: options.includeBuiltinEnginePlugins,
            pluginDirs: options.enginePluginDirs,
            pluginFiles: options.enginePluginFiles,
            plugins: options.enginePlugins,
            disabledPluginNames: options.disabledEnginePluginNames,
            isolatePluginNames: options.pluginIsolate,
            onWarning: (warning) => this.log(`engine plugin warning: ${warning}`),
        });
        return {
            plugins: loadedPlugins.plugins,
            warnings: [...loadedPlugins.warnings],
            runtime: createEnginePluginRuntime(loadedPlugins.plugins, {
                scene: this.scene,
                config: {
                    k,
                    verbose: this.verbose,
                    dryRun: options.pluginDryRun === true,
                    isolatedPluginNames: [...(options.pluginIsolate || [])],
                    moduleIds: modules.map(module => module.id),
                },
                dryRun: options.pluginDryRun === true,
            }),
        };
    }

    private resolveDisabledModuleIds(options: TaintEngineOptions): string[] {
        return [...new Set<string>([
            ...(options.disabledModuleIds || []),
        ]).values()];
    }

    private buildModuleCanonicalApiOccurrences() {
        const canonicalOccurrenceSites = this.apiEffectRuntimeIndex?.listCanonicalOccurrenceSites() || [];
        const effectSites = this.apiEffectRuntimeIndex?.listEffectSites() || [];
        const seen = new Set<string>();
        const semanticSitesByOccurrenceKey = new Map<string, SemanticEffectSite[]>();
        const outByKey = new Map<string, {
            stmt: any;
            canonicalApiId: string;
            occurrenceId: string;
            rawOccurrenceId: string;
            semanticEffectSites: SemanticEffectSite[];
        }>();

        for (const site of effectSites) {
            if (site.effect.identity.role !== "module") continue;
            const canonicalApiId = site.resolvedOccurrence.canonicalApiId;
            if (!canonicalApiId) continue;
            const key = `${site.resolvedOccurrence.occurrenceId}|${canonicalApiId}`;
            const current = semanticSitesByOccurrenceKey.get(key) || [];
            for (const semanticSite of site.semanticEffectSites) {
                if (current.some(existing => existing.effectSiteId === semanticSite.effectSiteId)) continue;
                current.push(semanticSite);
            }
            semanticSitesByOccurrenceKey.set(key, current);
        }

        for (const site of canonicalOccurrenceSites) {
            if (site.resolvedOccurrence.status !== "accepted") continue;
            const canonicalApiId = site.resolvedOccurrence.canonicalApiId;
            if (!canonicalApiId || !site.stmt) continue;
            const key = `${site.resolvedOccurrence.occurrenceId}|${canonicalApiId}`;
            const semanticEffectSites = semanticSitesByOccurrenceKey.get(key) || [];
            const existing = outByKey.get(key);
            if (!existing) {
                outByKey.set(key, {
                    stmt: site.stmt,
                    canonicalApiId,
                    occurrenceId: site.resolvedOccurrence.occurrenceId,
                    rawOccurrenceId: site.resolvedOccurrence.rawOccurrenceId,
                    semanticEffectSites: [...semanticEffectSites],
                });
                seen.add(key);
                for (const semanticSite of semanticEffectSites) {
                    seen.add(`${key}|${semanticSite.effectSiteId}`);
                }
                continue;
            }
            for (const semanticSite of semanticEffectSites) {
                if (seen.has(`${key}|${semanticSite.effectSiteId}`)) continue;
                existing.semanticEffectSites.push(semanticSite);
                seen.add(`${key}|${semanticSite.effectSiteId}`);
            }
        }
        return [...outByKey.values()];
    }

    private buildModuleCanonicalDecoratorOccurrences() {
        const decoratorSites = this.apiEffectRuntimeIndex?.listCanonicalDecoratorOccurrenceSites() || [];
        const outByKey = new Map<string, {
            ownerKind: "namespace" | "class" | "method" | "field";
            model: any;
            canonicalApiId: string;
            occurrenceId: string;
            rawOccurrenceId: string;
            semanticEffectSites: SemanticEffectSite[];
            decorator: {
                kind: string;
                param?: string;
                content?: string;
            };
        }>();
        for (const site of decoratorSites) {
            if (site.resolvedOccurrence.status !== "accepted") continue;
            const canonicalApiId = site.resolvedOccurrence.canonicalApiId;
            if (!canonicalApiId) continue;
            const key = `${site.resolvedOccurrence.occurrenceId}|${canonicalApiId}`;
            if (outByKey.has(key)) continue;
            outByKey.set(key, {
                ownerKind: site.ownerKind,
                model: site.model,
                canonicalApiId,
                occurrenceId: site.resolvedOccurrence.occurrenceId,
                rawOccurrenceId: site.resolvedOccurrence.rawOccurrenceId,
                semanticEffectSites: [...site.semanticEffectSites],
                decorator: {
                    kind: site.decorator.kind,
                    param: site.decorator.param,
                    content: site.decorator.content,
                },
            });
        }
        return [...outByKey.values()];
    }

    private log(msg: string): void {
        if (this.verbose) console.log(msg);
    }

    private progress(msg: string): void {
        if (this.options.progressOutput === "enabled" || this.verbose) {
            console.log(msg);
        }
    }

    private clearRuleHits(kind?: keyof RuleHitCounters): void {
        if (!kind) {
            this.ruleHits.source.clear();
            this.ruleHits.sink.clear();
            this.ruleHits.transfer.clear();
            return;
        }
        this.ruleHits[kind].clear();
    }

    private markRuleHit(kind: keyof RuleHitCounters, ruleId: string, delta: number = 1): void {
        if (!ruleId) return;
        const map = this.ruleHits[kind];
        map.set(ruleId, (map.get(ruleId) || 0) + delta);
    }

    private toRecord(map: Map<string, number>): Record<string, number> {
        const out: Record<string, number> = {};
        for (const [k, v] of [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
            out[k] = v;
        }
        return out;
    }

    private elapsedMsSince(startedAt: bigint): number {
        return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    }

    public getRuleHitCounters(): RuleHitCounters {
        return {
            source: this.toRecord(this.ruleHits.source),
            sink: this.toRecord(this.ruleHits.sink),
            transfer: this.toRecord(this.ruleHits.transfer),
        };
    }

    public getLoadedEnginePluginNames(): string[] {
        return this.enginePluginRuntime.listPluginNames();
    }

    public getEnginePluginWarnings(): string[] {
        return [...this.enginePluginWarnings];
    }

    public getEnginePluginAuditSnapshot(): EnginePluginAuditSnapshot {
        return this.enginePluginRuntime.getAuditSnapshot();
    }

    public getModuleAuditSnapshot(): ModuleAuditSnapshot {
        if (!this.moduleRuntime && this.pag) {
            this.refreshModuleRuntime();
        }
        const audit = this.moduleRuntime?.getAuditSnapshot();
        if (!audit) {
            return emptyModuleAuditSnapshot();
        }
        return audit;
    }

    public getArkMainSeedReport(): ArkMainSeedReport | undefined {
        if (!this.arkMainSeedReport) {
            return undefined;
        }
        return {
            ...this.arkMainSeedReport,
        };
    }

    public getOfficialOccurrenceLedger(): OfficialOccurrenceRecord[] {
        return this.apiEffectRuntimeIndex?.listOfficialOccurrenceRecords() || [];
    }

    public getCallEdgeMaterializationLedger(): CallEdgeMaterializationLedgerRecord[] {
        return this.callEdgeMaterializationLedger.map(record => ({
            ...record,
            srcNodeIds: record.srcNodeIds ? [...record.srcNodeIds] : undefined,
            dstNodeIds: record.dstNodeIds ? [...record.dstNodeIds] : undefined,
            evidence: record.evidence ? [...record.evidence] : undefined,
        }));
    }

    public getOfficialOccurrenceCoverageSnapshot(): OfficialOccurrenceCoverageSnapshot {
        return this.apiEffectRuntimeIndex?.getOfficialOccurrenceCoverage()
            || emptyOfficialOccurrenceCoverageSnapshot();
    }

    public getSemanticEffectLedger(): SemanticEffectLedgerRecord[] {
        if (!this.apiEffectRuntimeIndex) return [];
        const endpointRecords = this.getPagNodeResolutionAuditSnapshot().endpointResolutionRecords || [];
        return this.apiEffectRuntimeIndex.listSemanticEffectLedger(endpointRecords);
    }

    public getSemanticEffectLedgerSummary(): SemanticEffectLedgerSummary {
        if (!this.apiEffectRuntimeIndex) return summarizeSemanticEffectLedger([]);
        const endpointRecords = this.getPagNodeResolutionAuditSnapshot().endpointResolutionRecords || [];
        return this.apiEffectRuntimeIndex.getSemanticEffectLedgerSummary(endpointRecords);
    }

    public getPagBuildProfileSnapshot(): StageTimingProfile {
        return { ...this.lastPagBuildProfile };
    }

    public getSourceRulePropagationProfileSnapshot(): StageTimingProfile {
        return { ...this.lastSourceRulePropagationProfile };
    }

    public getExecutionHandoffContractSnapshot(): ExecutionHandoffContractSnapshot | undefined {
        return this.executionHandoffSnapshot
            ? this.cloneExecutionHandoffSnapshot(this.executionHandoffSnapshot)
            : undefined;
    }

    public getSyntheticInvokeEdgeSnapshot(): {
        totalEdges: number;
        callerSignatures: string[];
        calleeSignatures: string[];
    } {
        const callerSignatures = new Set<string>();
        const calleeSignatures = new Set<string>();
        let totalEdges = 0;
        for (const edges of this.syntheticInvokeEdgeMap.values()) {
            for (const edge of edges) {
                totalEdges += 1;
                if (edge.callerSignature) callerSignatures.add(edge.callerSignature);
                if (edge.calleeSignature) calleeSignatures.add(edge.calleeSignature);
            }
        }
        return {
            totalEdges,
            callerSignatures: [...callerSignatures].sort(),
            calleeSignatures: [...calleeSignatures].sort(),
        };
    }

    private refreshModuleRuntime(): void {
        if (!this.pag) return;
        const currentnessKey = `currentness|${this.options.currentness || "enabled"}`;
        const allowedMethodSignatures = this.activeReachableMethodSignatures;
        const scopeKey = allowedMethodSignatures && allowedMethodSignatures.size > 0
            ? `scope|${[...allowedMethodSignatures].sort().join("\u001f")}`
            : "scope|all_methods";
        const runtimeKey = `${scopeKey}|${currentnessKey}`;
        if (this.moduleRuntime && this.moduleRuntimePag === this.pag && this.moduleRuntimeKey === runtimeKey) {
            return;
        }
        this.moduleRuntime = createModuleRuntime(this.modules, {
            scene: this.scene,
            pag: this.pag,
            allowedMethodSignatures,
            fieldToVarIndex: this.fieldToVarIndex,
            queries: {
                resolveMethodsFromCallable,
                collectParameterAssignStmts,
                collectFiniteStringCandidatesFromValue,
            },
            log: this.log.bind(this),
            moduleSetupDeadlineMs: this.options.debug?.moduleSetupMaxElapsedMs,
            currentnessAnalysis: this.options.currentness || "enabled",
            canonicalApiOccurrences: this.buildModuleCanonicalApiOccurrences(),
            canonicalDecoratorOccurrences: this.buildModuleCanonicalDecoratorOccurrences(),
        });
        this.moduleRuntimeKey = runtimeKey;
        this.moduleRuntimePag = this.pag;
        if (this.activePagCacheEntry && this.cg && this.pag) {
            this.rebuildExecutionHandoffLayer(
                this.activePagCacheEntry,
                this.options.executionHandoff !== "disabled",
            );
        }
    }

    public getPagNodeResolutionAuditSnapshot(): PagNodeResolutionAuditSnapshot {
        if (!this.pag) {
            return emptyPagNodeResolutionAuditSnapshot();
        }
        return this.completeEndpointResolutionAuditSnapshot(getPagNodeResolutionAuditSnapshot(this.pag));
    }

    private completeEndpointResolutionAuditSnapshot(
        snapshot: PagNodeResolutionAuditSnapshot,
    ): PagNodeResolutionAuditSnapshot {
        const projectedRecords = snapshot.endpointResolutionRecords || [];
        const records = this.apiEffectRuntimeIndex
            ? this.apiEffectRuntimeIndex.completeEndpointResolutionLedger(projectedRecords)
            : projectedRecords.map(record => cloneEndpointResolutionLedgerItem(record));
        return {
            ...snapshot,
            endpointResolutionRecordCount: records.length,
            endpointResolutionStatusCounts: summarizeEndpointResolutionStatuses(records),
            endpointResolutionRecords: records,
        };
    }

    private cloneExecutionHandoffSnapshot(
        snapshot: ExecutionHandoffContractSnapshot,
    ): ExecutionHandoffContractSnapshot {
        return {
            totalContracts: snapshot.totalContracts,
            contracts: snapshot.contracts.map((item: ExecutionHandoffContractSnapshotItem) => ({
                ...item,
                pathLabels: [...item.pathLabels],
                ports: { ...item.ports },
            })),
        };
    }

    private configureExecutionHandoffLayer(cacheEntry: PagBuildCacheEntry, emitEdges: boolean = true): void {
        this.log("[ExecutionHandoff] module runtime refresh start");
        this.refreshModuleRuntime();
        this.log("[ExecutionHandoff] module runtime refresh done");
        this.rebuildExecutionHandoffLayer(cacheEntry, emitEdges);
    }

    private rebuildExecutionHandoffLayer(cacheEntry: PagBuildCacheEntry, emitEdges: boolean = true): void {
        this.log("[ExecutionHandoff] deferred bindings collect start");
        const deferredBindings = this.moduleRuntime?.getDeferredBindingDeclarations() || [];
        this.log(`[ExecutionHandoff] deferred bindings collect done count=${deferredBindings.length}`);
        this.log("[ExecutionHandoff] deferred bindings key start");
        const deferredBindingsKey = this.buildDeferredBindingKey(deferredBindings);
        this.log("[ExecutionHandoff] deferred bindings key done");
        if (
            cacheEntry.executionHandoffSnapshot
            && cacheEntry.executionHandoffDeferredSiteKeys
            && cacheEntry.executionHandoffEmitEdges === emitEdges
            && cacheEntry.executionHandoffBindingsKey === deferredBindingsKey
        ) {
            this.executionHandoffSnapshot = this.cloneExecutionHandoffSnapshot(cacheEntry.executionHandoffSnapshot);
            this.executionHandoffDeferredSiteKeys = new Set(cacheEntry.executionHandoffDeferredSiteKeys);
            this.syntheticInvokeEdgeMap = cacheEntry.syntheticInvokeEdgeMap;
            this.log(`[ExecutionHandoff] reused cached contracts=${cacheEntry.executionHandoffSnapshot.totalContracts}`);
            return;
        }

        this.log("[ExecutionHandoff] contract build start");
        const contracts = buildExecutionHandoffContracts(
            this.scene,
            this.cg,
            this.pag,
            deferredBindings,
            {
                startedAtMs: Date.now(),
                maxElapsedMs: this.options.debug?.executionHandoffMaxElapsedMs,
                progress: msg => this.progress(msg),
                progressIntervalMs: 5000,
            },
        );
        this.log(`[ExecutionHandoff] contract build done count=${contracts.length}`);
        const deferredSiteKeys = new Set<string>();
        for (const contract of contracts) {
            const siteKey = buildExecutionHandoffSiteKeyFromRecord(contract);
            deferredSiteKeys.add(siteKey);
        }
        if (!emitEdges) {
            deferredSiteKeys.add(EXCLUDE_ALL_DEFERRED_SYNTHETIC_INVOKE_SITES);
        }

        this.executionHandoffDeferredSiteKeys = deferredSiteKeys;
        cacheEntry.executionHandoffDeferredSiteKeys = new Set(deferredSiteKeys);

        const snapshot = buildExecutionHandoffSnapshot(contracts);
        this.executionHandoffSnapshot = snapshot;
        cacheEntry.executionHandoffSnapshot = this.cloneExecutionHandoffSnapshot(snapshot);
        cacheEntry.executionHandoffEmitEdges = emitEdges;
        cacheEntry.executionHandoffBindingsKey = deferredBindingsKey;
        this.log(`[ExecutionHandoff] contracts=${snapshot.totalContracts}`);

        if (!emitEdges) {
            this.log("[ExecutionHandoff] edge emission disabled; deferred sites are retained for baseline filtering.");
            return;
        }

        this.log("[ExecutionHandoff] contract edge emission start");
        const contractEdges = buildExecutionHandoffSyntheticInvokeEdges(
            contracts,
        );
        this.log(
            `[ExecutionHandoff] contract synthetic sites=${contractEdges.stats.siteCount}, callEdges=${contractEdges.stats.callEdges}`,
        );

        const mergedEdgeMap = new Map<number, SyntheticInvokeEdgeInfo[]>();
        this.mergeSyntheticInvokeEdgeMaps(mergedEdgeMap, this.syntheticInvokeEdgeMap);
        this.mergeSyntheticInvokeEdgeMaps(mergedEdgeMap, contractEdges.edgeMap);
        this.syntheticInvokeEdgeMap = mergedEdgeMap;
        cacheEntry.syntheticInvokeEdgeMap = this.syntheticInvokeEdgeMap;
        cacheEntry.syntheticInvokeLazyMaterializer = this.syntheticInvokeLazyMaterializer;
        cacheEntry.syntheticInvokeEdgeMapReady = false;
    }

    private buildDeferredBindingKey(bindings: unknown[]): string {
        return bindings
            .map((binding: any) => [
                binding?.moduleId || "",
                binding?.bindingKind || "",
                binding?.sourceMethod?.getSignature?.()?.toString?.() || "",
                binding?.unit?.getSignature?.()?.toString?.() || "",
                binding?.anchorStmt?.getOriginPositionInfo?.()?.getLineNo?.() || 0,
                binding?.carrierKind || "",
                binding?.activationSource || "",
                binding?.payloadSource || "",
                binding?.reason || "",
            ].join("\u001f"))
            .sort()
            .join("\u001e");
    }

    private mergeSyntheticInvokeEdgeMaps(
        target: Map<number, SyntheticInvokeEdgeInfo[]>,
        source: Map<number, SyntheticInvokeEdgeInfo[]>,
    ): void {
        for (const [nodeId, edges] of source.entries()) {
            if (!target.has(nodeId)) {
                target.set(nodeId, []);
            }
            const dest = target.get(nodeId)!;
            const seen = new Set<string>(
                dest.map(edge => [
                    edge.type,
                    edge.srcNodeId,
                    edge.dstNodeId,
                    edge.callSiteId,
                    edge.callerSignature || "",
                    edge.calleeSignature || "",
                    edge.originTag || "",
                    edge.handoffId || "",
                ].join("|")),
            );
            for (const edge of edges) {
                const key = [
                    edge.type,
                    edge.srcNodeId,
                    edge.dstNodeId,
                    edge.callSiteId,
                    edge.callerSignature || "",
                    edge.calleeSignature || "",
                    edge.originTag || "",
                    edge.handoffId || "",
                ].join("|");
                if (seen.has(key)) continue;
                seen.add(key);
                dest.push(edge);
            }
        }
    }

    private parseSourceRuleId(source: string): string | undefined {
        if (!source.startsWith("source_rule:")) return undefined;
        const rawId = source.slice("source_rule:".length).trim();
        const id = rawId.split("#occ=")[0]?.trim() || "";
        return id.length > 0 ? id : undefined;
    }

    private orderRulesByFamily<T extends BaseRule>(rules: T[]): T[] {
        return orderRulesByFamilyAndId(rules);
    }

    private cloneFlowRuleChain(chain?: FlowRuleChain): FlowRuleChain {
        return {
            sourceRuleId: chain?.sourceRuleId,
            transferRuleIds: [...(chain?.transferRuleIds || [])],
        };
    }

    private initialFlowRuleChainForFact(fact: TaintFact): FlowRuleChain {
        return {
            sourceRuleId: this.parseSourceRuleId(fact.source),
            transferRuleIds: [],
        };
    }

    private clearFactRuleChains(): void {
        this.factRuleChains.clear();
        this.factPredecessorsByFactId.clear();
        this.factPredecessorEdgeKeys.clear();
        this.currentnessEvidenceById.clear();
    }

    public resetPropagationState(): void {
        this.tracker.clear();
        this.observedFacts.clear();
        this.lastEnginePluginFindings = [];
        this.clearFactRuleChains();
        this.clearRuleHits();
        this.resetDetectProfile();
        this.interproceduralTaintTargetNodeIdsCache = undefined;
    }

    public resetDetectProfile(): void {
        this.detectProfile = createEmptySinkDetectProfile();
        this.sinkDetectionAudit = [];
        this.sinkDetectionAuditOverflowCount = 0;
    }

    public getDetectProfile(): DetectProfileSnapshot {
        return { ...this.detectProfile };
    }

    public getSinkDetectionAuditSnapshot(): {
        entries: SinkDetectAuditEntry[];
        overflowCount: number;
    } {
        return {
            entries: this.sinkDetectionAudit.map(entry => ({
                ...entry,
                candidateNodeIds: entry.candidateNodeIds ? [...entry.candidateNodeIds] : undefined,
                sinkFieldPath: entry.sinkFieldPath ? [...entry.sinkFieldPath] : undefined,
            })),
            overflowCount: this.sinkDetectionAuditOverflowCount,
        };
    }

    private recordSinkDetectionAudit(entry: SinkDetectAuditEntry): void {
        const emitted = entry.kind === "hit";
        this.traceGraph?.recordAuditGate({
            label: entry.source,
            toFact: entry.sinkNodeId !== undefined
                ? `${entry.sinkNodeId}@0${entry.sinkFieldPath && entry.sinkFieldPath.length > 0 ? `.${entry.sinkFieldPath.join(".")}` : ""}#src=${encodeURIComponent(entry.source || "")}`
                : undefined,
            stage: "sink_candidate",
            producer: "sink",
            gateKind: "sink_candidate",
            scope: entry.ruleId ? `sink_rule:${entry.ruleId}` : `sink_effect:${entry.effectIdentity || "unknown"}`,
            attempted: true,
            matched: entry.kind !== "callsite",
            emitted,
            skippedReason: entry.kind === "rejected" ? entry.reason : undefined,
            blockedReason: entry.kind === "sanitized" ? entry.reason : undefined,
            evidence: {
                kind: entry.kind,
                ruleId: entry.ruleId,
                effectIdentity: entry.effectIdentity,
                calleeSignature: entry.calleeSignature,
                sinkText: entry.sinkText,
                endpoint: entry.endpoint,
                candidateNodeIds: entry.candidateNodeIds,
                reason: entry.reason,
            },
        });
        if (this.sinkDetectionAudit.length >= 500) {
            this.sinkDetectionAuditOverflowCount += 1;
            return;
        }
        this.sinkDetectionAudit.push({
            ...entry,
            candidateNodeIds: entry.candidateNodeIds ? [...entry.candidateNodeIds] : undefined,
            sinkFieldPath: entry.sinkFieldPath ? [...entry.sinkFieldPath] : undefined,
        });
    }

    private mergeDetectProfile(profile: SinkDetectProfile): void {
        this.detectProfile = mergeSinkDetectProfiles(this.detectProfile, profile);
    }

    private upsertFactRuleChain(factId: string, chain: FactRuleChain | FlowRuleChain): void {
        this.factRuleChains.set(factId, this.cloneFlowRuleChain(chain));
    }

    public getRuleChainByFactId(factId: string): FlowRuleChain | undefined {
        const chain = this.factRuleChains.get(factId);
        return chain ? this.cloneFlowRuleChain(chain) : undefined;
    }

    public getRuleChainsForNodeAnyContext(nodeId: number, fieldPath?: string[]): FlowRuleChain[] {
        const factIds = this.tracker.getTaintFactIdsAnyContext(nodeId, fieldPath);
        const out: FlowRuleChain[] = [];
        const seen = new Set<string>();
        for (const factId of factIds) {
            const chain = this.factRuleChains.get(factId);
            if (!chain) continue;
            const key = `${chain.sourceRuleId || ""}|${chain.transferRuleIds.join("->")}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(this.cloneFlowRuleChain(chain));
        }
        return out;
    }

    private resolveBestSinkFactId(nodeId: number, fieldPath?: string[], source?: string, sourceRuleId?: string): string | undefined {
        const factIds = this.tracker.getTaintFactIdsAnyContext(nodeId, fieldPath);
        if (factIds.length === 0) return undefined;
        if (source) {
            for (const factId of factIds) {
                const fact = this.observedFacts.get(factId);
                if (fact?.source === source) {
                    return factId;
                }
            }
        }
        if (!sourceRuleId) return factIds[0];
        for (const factId of factIds) {
            const chain = this.factRuleChains.get(factId);
            if (chain?.sourceRuleId === sourceRuleId) {
                return factId;
            }
        }
        return factIds[0];
    }

    public async buildPAG(options: BuildPAGOptions = {}): Promise<void> {
        this.progress("[buildPAG] start");
        this.lastPagBuildProfile = {};
        const buildProfileStart = process.hrtime.bigint();
        const recordBuildProfile = (key: string, startedAt: bigint): void => {
            this.lastPagBuildProfile[key] = this.elapsedMsSince(startedAt);
        };
        this.resetPropagationState();
        this.moduleRuntime = undefined;
        this.moduleRuntimeKey = undefined;
        this.moduleRuntimePag = undefined;
        this.executionHandoffSnapshot = undefined;
        this.activeReachableMethodSignatures = undefined;
        this.activeOrderedMethodSignatures = undefined;
        this.callEdgeMaterializationLedger = [];

        const entryModel: EntryModel = options.entryModel || "arkMain";
        this.currentEntryModel = entryModel;
        const explicitSyntheticEntries = this.normalizeSyntheticEntryMethods(options.syntheticEntryMethods);
        this.explicitEntryScopeMethodSignatures = this.resolveExplicitEntryScope(explicitSyntheticEntries);
        this.progress("[buildPAG] arkmain plan start");
        const arkMainPlanT0 = process.hrtime.bigint();
        const arkMainPlan = entryModel === "arkMain"
            ? buildArkMainPlan(this.scene, {
                seedMethods: explicitSyntheticEntries,
                seededMethods: this.options.arkMainSeeds?.methods,
                seededFacts: this.options.arkMainSeeds?.facts,
            })
            : undefined;
        recordBuildProfile("arkMainPlanMs", arkMainPlanT0);
        this.progress("[buildPAG] arkmain plan done");
        this.arkMainSeedReport = entryModel === "arkMain"
            ? {
                enabled: Boolean(
                    (this.options.arkMainSeeds?.methods && this.options.arkMainSeeds.methods.length > 0)
                    || (this.options.arkMainSeeds?.facts && this.options.arkMainSeeds.facts.length > 0),
                ),
                methodCount: this.options.arkMainSeeds?.methods?.length || 0,
                factCount: this.options.arkMainSeeds?.facts?.length || 0,
            }
            : undefined;
        const arkMainEntryClosureMethods = entryModel === "arkMain"
            ? this.resolveArkMainScheduledEntryMethods(arkMainPlan?.orderedMethods || [])
            : [];
        this.activeOrderedMethodSignatures = entryModel === "arkMain"
            ? arkMainEntryClosureMethods.map(method => safeMethodSignatureText(method)).filter((sig): sig is string => !!sig)
            : undefined;
        this.autoEntrySourceRules = entryModel === "arkMain"
            ? this.buildAutoEntrySourceRules(arkMainPlan)
            : [];
        this.autoAmbientSourceRules = entryModel === "arkMain"
            ? this.buildAmbientFrameworkSourceRules(arkMainPlan)
            : [];
        if (arkMainPlan?.schedule.convergence.truncated) {
            for (const warning of arkMainPlan.schedule.warnings) {
                this.log(`[ArkMain] WARNING: ${warning}`);
            }
        }
        const syntheticEntryMethods = entryModel === "arkMain"
            ? this.resolveSyntheticEntryMethods(
                explicitSyntheticEntries,
                entryModel,
                arkMainPlan,
                arkMainEntryClosureMethods,
            )
            : explicitSyntheticEntries;
        const executionHandoffEnabled = this.options.executionHandoff !== "disabled";
        const handoffKey = executionHandoffEnabled ? "handoff|enabled" : "handoff|disabled";
        const syntheticKey = syntheticEntryMethods.length > 0
            ? `synthetic|${syntheticEntryMethods.map(method => safeMethodSignatureText(method)).filter(Boolean).join("||")}`
            : "pure";
        const cacheKey = `entryModel|${entryModel}|${syntheticKey}|${handoffKey}|modules|${this.buildModulePlanCacheKey()}`;
        const sceneCache = this.getPagBuildCacheForScene();
        const cached = sceneCache.get(cacheKey);
        if (cached) {
            const cacheRestoreT0 = process.hrtime.bigint();
            this.activePagCacheEntry = cached;
            this.pag = cached.pag;
            this.cg = cached.cg;
            this.fieldToVarIndex = cached.fieldToVarIndex;
            this.callEdgeMap = cached.callEdgeMap;
            this.receiverFieldBridgeMap = cached.receiverFieldBridgeMap;
            this.captureEdgeMap = cached.captureEdgeMap;
            this.syntheticInvokeEdgeMap = cached.syntheticInvokeEdgeMap;
            this.syntheticConstructorStoreMap = cached.syntheticConstructorStoreMap;
            this.syntheticStaticInitStoreMap = cached.syntheticStaticInitStoreMap;
            this.syntheticFieldBridgeMap = cached.syntheticFieldBridgeMap;
            this.callEdgeMaterializationLedger = cached.callEdgeMaterializationLedger || [];
            this.captureLazyMaterializer = cached.captureLazyMaterializer;
            this.syntheticInvokeLazyMaterializer = cached.syntheticInvokeLazyMaterializer;
            this.executionHandoffSnapshot = cached.executionHandoffSnapshot
                ? this.cloneExecutionHandoffSnapshot(cached.executionHandoffSnapshot)
                : undefined;
            this.executionHandoffDeferredSiteKeys = cached.executionHandoffDeferredSiteKeys
                ? new Set(cached.executionHandoffDeferredSiteKeys)
                : undefined;
            resetPagNodeResolutionAudit(this.pag);
            this.log(`PAG cache hit: ${entryModel}(${syntheticKey})`);
            this.progress(`PAG nodes: ${this.pag.getNodeNum()}, edges: ${this.pag.getEdgeNum()}`);
            this.progress(`CG nodes: ${this.cg.getNodeNum()}, edges: ${this.cg.getEdgeNum()}`);
            this.configureContextStrategy();
            recordBuildProfile("cacheRestoreMs", cacheRestoreT0);
            const computeReachableT0 = process.hrtime.bigint();
            const reachable = this.computeReachableMethodSignatures();
            recordBuildProfile("computeReachableMs", computeReachableT0);
            this.mergeReachableProfileIntoBuildProfile();
            const setReachableT0 = process.hrtime.bigint();
            this.setActiveReachableMethodSignatures(reachable);
            recordBuildProfile("setActiveReachableMs", setReachableT0);
            this.lastPagBuildProfile.reachableMs =
                (this.lastPagBuildProfile.computeReachableMs || 0)
                + (this.lastPagBuildProfile.setActiveReachableMs || 0);
            this.lastPagBuildProfile.totalMs = this.elapsedMsSince(buildProfileStart);
            this.lastPagBuildProfile.cacheHit = 1;
            return;
        }

        this.progress("[buildPAG] callgraph scene start");
        const sceneCallGraphT0 = process.hrtime.bigint();
        const cg = new CallGraph(this.scene);
        const cgBuilder = new CallGraphBuilder(cg, this.scene);
        cgBuilder.buildDirectCallGraphForScene();
        recordBuildProfile("directCallGraphSceneMs", sceneCallGraphT0);
        this.progress("[buildPAG] callgraph scene done");
        const pag = new Pag();
        resetPagNodeResolutionAudit(pag);
        const config = PointerAnalysisConfig.create(0, "./out", false, false, false);
        this.pta = new PointerAnalysis(pag, cg, this.scene, config);
        this.progress("[buildPAG] synthetic root start");
        const syntheticRootT0 = process.hrtime.bigint();
        const { syntheticRootMethod, cleanup } = this.createSyntheticEntry(entryModel, syntheticEntryMethods);
        recordBuildProfile("syntheticRootCreateMs", syntheticRootT0);
        try {
            this.progress("[buildPAG] direct callgraph root start");
            const rootCallGraphT0 = process.hrtime.bigint();
            cgBuilder.buildDirectCallGraph([syntheticRootMethod]);
            recordBuildProfile("directCallGraphRootMs", rootCallGraphT0);
            this.progress("[buildPAG] direct callgraph root done");
            const syntheticRootMethodId = cg.getCallGraphNodeByMethod(syntheticRootMethod.getSignature()).getID();
            cg.setDummyMainFuncID(syntheticRootMethodId);
            this.pta.setEntries([syntheticRootMethodId]);
            this.progress("[buildPAG] pointer analysis start");
            const pointerAnalysisT0 = process.hrtime.bigint();
            this.pta.start();
            recordBuildProfile("pointerAnalysisMs", pointerAnalysisT0);
            this.progress("[buildPAG] pointer analysis done");
        } finally {
            const cleanupT0 = process.hrtime.bigint();
            cleanup();
            recordBuildProfile("syntheticRootCleanupMs", cleanupT0);
        }
        this.pag = this.pta.getPag();
        this.cg = cg;

        this.progress(`PAG nodes: ${this.pag.getNodeNum()}, edges: ${this.pag.getEdgeNum()}`);
        this.progress(`CG nodes: ${this.cg.getNodeNum()}, edges: ${this.cg.getEdgeNum()}`);
        const pagMethodScope = this.collectPagMethodScope();
        this.lastPagBuildProfile.pagMethodScopeCount = pagMethodScope.length;
        this.progress(`[buildPAG] pag method scope methods=${pagMethodScope.length}`);

        this.progress("[buildPAG] indexes start");
        const fieldIndexT0 = process.hrtime.bigint();
        this.progress("[buildPAG] field index start");
        this.fieldToVarIndex = buildFieldToVarIndex(this.pag, this.log.bind(this));
        recordBuildProfile("fieldToVarIndexMs", fieldIndexT0);
        this.progress(`[buildPAG] field index done elapsed_ms=${Math.round(this.lastPagBuildProfile.fieldToVarIndexMs || 0)}`);
        const callEdgeMapT0 = process.hrtime.bigint();
        this.progress("[buildPAG] call edge map start");
        this.callEdgeMap = buildCallEdgeMap(this.scene, this.cg, this.pag, this.log.bind(this), {
            diagnostics: this.options.progressOutput === "enabled" ? "disabled" : "enabled",
            progress: this.progress.bind(this),
            progressEveryMethods: 100,
            methods: pagMethodScope,
        });
        recordBuildProfile("callEdgeMapMs", callEdgeMapT0);
        this.progress(`[buildPAG] call edge map done elapsed_ms=${Math.round(this.lastPagBuildProfile.callEdgeMapMs || 0)}`);
        const receiverFieldBridgeT0 = process.hrtime.bigint();
        if (this.options.receiverFieldBridgeMap === "disabled") {
            this.receiverFieldBridgeMap = new Map();
            this.lastPagBuildProfile.receiverFieldBridgeMapSkipped = 1;
            recordBuildProfile("receiverFieldBridgeMapMs", receiverFieldBridgeT0);
            this.progress("[buildPAG] receiver field bridge map skipped mode=candidate_fast");
        } else {
            this.progress("[buildPAG] receiver field bridge map start");
            this.receiverFieldBridgeMap = buildReceiverFieldBridgeMap(this.scene, this.cg, this.pag, this.log.bind(this), {
                startedAtMs: Date.now(),
                maxElapsedMs: this.options.debug?.pagIndexMaxElapsedMs,
                label: "receiver_field_bridge_map",
            }, {
                methods: pagMethodScope,
            });
            recordBuildProfile("receiverFieldBridgeMapMs", receiverFieldBridgeT0);
            this.progress(`[buildPAG] receiver field bridge map done elapsed_ms=${Math.round(this.lastPagBuildProfile.receiverFieldBridgeMapMs || 0)}`);
        }
        this.progress("[buildPAG] indexes done");
        this.captureEdgeMap = new Map<number, CaptureEdgeInfo[]>();
        this.syntheticInvokeEdgeMap = new Map<number, SyntheticInvokeEdgeInfo[]>();
        this.progress("[buildPAG] synthetic summaries start");
        const syntheticConstructorStoreT0 = process.hrtime.bigint();
        this.syntheticConstructorStoreMap = buildSyntheticConstructorStoreMap(this.scene, this.cg, this.pag, this.log.bind(this));
        recordBuildProfile("syntheticConstructorStoreMapMs", syntheticConstructorStoreT0);
        const syntheticStaticInitStoreT0 = process.hrtime.bigint();
        this.syntheticStaticInitStoreMap = buildSyntheticStaticInitStoreMap(this.scene, this.cg, this.pag, this.log.bind(this));
        recordBuildProfile("syntheticStaticInitStoreMapMs", syntheticStaticInitStoreT0);
        const syntheticFieldBridgeT0 = process.hrtime.bigint();
        this.syntheticFieldBridgeMap = buildSyntheticFieldBridgeMap(this.scene, this.cg, this.pag, this.log.bind(this));
        recordBuildProfile("syntheticFieldBridgeMapMs", syntheticFieldBridgeT0);
        this.progress("[buildPAG] synthetic summaries done");
        const cacheEntry: PagBuildCacheEntry = {
            pag: this.pag,
            cg: this.cg,
            fieldToVarIndex: this.fieldToVarIndex,
            callEdgeMap: this.callEdgeMap,
            receiverFieldBridgeMap: this.receiverFieldBridgeMap,
            captureEdgeMap: this.captureEdgeMap,
            syntheticInvokeEdgeMap: this.syntheticInvokeEdgeMap,
            syntheticConstructorStoreMap: this.syntheticConstructorStoreMap,
            syntheticStaticInitStoreMap: this.syntheticStaticInitStoreMap,
            syntheticFieldBridgeMap: this.syntheticFieldBridgeMap,
            callEdgeMaterializationLedger: this.callEdgeMaterializationLedger,
            captureLazyMaterializer: undefined,
            syntheticInvokeLazyMaterializer: undefined,
            captureEdgeMapReady: false,
            syntheticInvokeEdgeMapReady: false,
            executionHandoffSnapshot: undefined,
            executionHandoffDeferredSiteKeys: undefined,
        };
        this.activePagCacheEntry = cacheEntry;
        this.progress("[buildPAG] execution handoff start");
        const executionHandoffT0 = process.hrtime.bigint();
        this.configureExecutionHandoffLayer(cacheEntry, executionHandoffEnabled);
        recordBuildProfile("executionHandoffMs", executionHandoffT0);
        this.progress("[buildPAG] execution handoff done");
        this.progress("[buildPAG] lazy materializers start");
        const captureLazyT0 = process.hrtime.bigint();
        this.progress("[buildPAG] capture lazy materializer start");
        this.captureLazyMaterializer = buildCaptureLazyMaterializer(
            this.scene,
            this.cg,
            this.pag,
            this.executionHandoffDeferredSiteKeys,
            {
                startedAtMs: Date.now(),
                maxElapsedMs: this.options.debug?.lazyMaterializerMaxElapsedMs,
                label: "capture_lazy_materializer",
            },
            {
                progress: msg => this.progress(`[buildPAG] ${msg}`),
                progressInterval: 100,
            },
        );
        recordBuildProfile("captureLazyMaterializerMs", captureLazyT0);
        this.progress("[buildPAG] capture lazy materializer done");
        const syntheticInvokeLazyT0 = process.hrtime.bigint();
        if (this.options.syntheticInvokeMaterialization === "disabled") {
            this.syntheticInvokeLazyMaterializer = undefined;
            cacheEntry.syntheticInvokeEdgeMapReady = true;
            this.lastPagBuildProfile.syntheticInvokeMaterializerSkipped = 1;
            this.progress("[buildPAG] synthetic invoke lazy materializer skipped mode=candidate_fast");
        } else {
            this.progress("[buildPAG] synthetic invoke lazy materializer start");
            this.syntheticInvokeLazyMaterializer = buildSyntheticInvokeLazyMaterializer(
                this.scene,
                this.cg,
                this.pag,
                this.log.bind(this),
                {
                    startedAtMs: Date.now(),
                    maxElapsedMs: this.options.debug?.lazyMaterializerMaxElapsedMs,
                    label: "synthetic_invoke_lazy_materializer",
                },
                this.callEdgeMaterializationLedger,
            );
        }
        recordBuildProfile("syntheticInvokeLazyMaterializerMs", syntheticInvokeLazyT0);
        if (this.options.syntheticInvokeMaterialization !== "disabled") {
            this.progress("[buildPAG] synthetic invoke lazy materializer done");
        }
        this.progress("[buildPAG] lazy materializers done");
        cacheEntry.captureLazyMaterializer = this.captureLazyMaterializer;
        cacheEntry.syntheticInvokeLazyMaterializer = this.syntheticInvokeLazyMaterializer;
        sceneCache.set(cacheKey, cacheEntry);
        this.configureContextStrategy();
        this.progress("[buildPAG] reachable start");
        const computeReachableT0 = process.hrtime.bigint();
        const reachable = this.computeReachableMethodSignatures();
        recordBuildProfile("computeReachableMs", computeReachableT0);
        this.mergeReachableProfileIntoBuildProfile();
        const setReachableT0 = process.hrtime.bigint();
        this.setActiveReachableMethodSignatures(reachable);
        recordBuildProfile("setActiveReachableMs", setReachableT0);
        this.lastPagBuildProfile.reachableMs =
            (this.lastPagBuildProfile.computeReachableMs || 0)
            + (this.lastPagBuildProfile.setActiveReachableMs || 0);
        this.progress("[buildPAG] reachable done");
        this.lastPagBuildProfile.totalMs = this.elapsedMsSince(buildProfileStart);
        this.lastPagBuildProfile.cacheHit = 0;
    }

    private mergeReachableProfileIntoBuildProfile(): void {
        for (const [key, value] of Object.entries(this.lastReachableProfile)) {
            this.lastPagBuildProfile[`reachable.${key}`] = value;
        }
    }

    private resolveSyntheticEntryMethods(
        explicitSyntheticEntries: ArkMethod[],
        entryModel: EntryModel,
        arkMainPlan?: ReturnType<typeof buildArkMainPlan>,
        arkMainEntryClosureMethods?: ArkMethod[],
    ): ArkMethod[] {
        const arkMainMethods = arkMainEntryClosureMethods && arkMainEntryClosureMethods.length > 0
            ? arkMainEntryClosureMethods
            : (arkMainPlan || buildArkMainPlan(this.scene, { seedMethods: explicitSyntheticEntries })).orderedMethods;
        const defaultEntries = this.mergeSyntheticEntryMethods(
            explicitSyntheticEntries,
            arkMainMethods,
        );
        return this.enginePluginRuntime.resolveEntries(defaultEntries, {
            discover: () => ({
                orderedMethods: [...defaultEntries],
            }),
        });
    }

    private expandArkMainScheduledEntryClosure(methods: ArkMethod[]): ArkMethod[] {
        if (methods.length === 0) return [];
        const startedAt = process.hrtime.bigint();
        let componentIndexMs = 0;
        const componentEntrypointIndex = new Map<string, string[]>();
        const componentIndexScanned = new Set<string>();
        const methodsBySig = this.getMethodsBySignature();
        const selected = new Map<string, ArkMethod>();
        const directTargetCache = new Map<string, ArkMethod[]>();
        const directQueue: ArkMethod[] = [];
        const directQueued = new Set<string>();
        const directExpanded = new Set<string>();
        let directExpansionMs = 0;
        let directExpansionAttemptCount = 0;
        let keyedCallbackMs = 0;
        let keyedCallbackPassCount = 0;
        let keyedCallbackAddedCount = 0;
        let componentExpansionMs = 0;
        const mergeMethod = (method: ArkMethod | undefined): boolean => {
            const signature = method ? safeMethodSignatureText(method) : undefined;
            if (!signature || selected.has(signature)) return false;
            selected.set(signature, method!);
            if (!directQueued.has(signature) && !directExpanded.has(signature)) {
                directQueued.add(signature);
                directQueue.push(method!);
            }
            return true;
        };
        const mergeMethods = (incoming: Iterable<ArkMethod>): boolean => {
            let changed = false;
            for (const method of incoming) {
                if (mergeMethod(method)) changed = true;
            }
            return changed;
        };

        const collectCachedDirectTargets = (method: ArkMethod): ArkMethod[] => {
            const signature = safeMethodSignatureText(method);
            if (!signature) return [];
            const cached = directTargetCache.get(signature);
            if (cached) return cached;
            directExpansionAttemptCount++;
            const directStartedAt = process.hrtime.bigint();
            const targets = collectDirectCallExpansionTargetMethods(this.scene, method, {
                includeKeyedDispatchCallbacks: false,
            });
            const elapsedMs = this.elapsedMsSince(directStartedAt);
            directExpansionMs += elapsedMs;
            if (elapsedMs > 5000 || directExpansionAttemptCount === 1 || directExpansionAttemptCount % 100 === 0) {
                this.progress(
                    `[ArkMain] entry closure direct #${directExpansionAttemptCount} `
                    + `targets=${targets.length} elapsed_ms=${Math.round(elapsedMs)} `
                    + `selected=${selected.size} queue=${directQueue.length} current=${this.shortReachableSignature(signature)}`,
                );
            }
            directTargetCache.set(signature, targets);
            return targets;
        };

        const drainDirectClosure = (): void => {
            let keyedCallbackPassExpandedCount = 0;
            while (directQueue.length > 0 || keyedCallbackPassExpandedCount !== selected.size) {
                if (directQueue.length > 0) {
                    this.progress(
                        `[ArkMain] entry closure direct drain start queue=${directQueue.length} `
                        + `selected=${selected.size} expanded=${directExpanded.size}`,
                    );
                }
                while (directQueue.length > 0) {
                    const method = directQueue.shift()!;
                    const signature = safeMethodSignatureText(method);
                    if (!signature || directExpanded.has(signature)) continue;
                    directExpanded.add(signature);
                    mergeMethods(collectCachedDirectTargets(method));
                }

                keyedCallbackPassExpandedCount = selected.size;
                keyedCallbackPassCount++;
                const keyedStartedAt = process.hrtime.bigint();
                const callbacks = collectKeyedDispatchCallbackMethods(this.scene, [...selected.values()]);
                const keyedElapsedMs = this.elapsedMsSince(keyedStartedAt);
                keyedCallbackMs += keyedElapsedMs;
                const before = selected.size;
                const changed = mergeMethods(callbacks);
                const added = selected.size - before;
                keyedCallbackAddedCount += added;
                if (keyedElapsedMs > 5000 || keyedCallbackPassCount === 1 || added > 0) {
                    this.progress(
                        `[ArkMain] entry closure keyed pass #${keyedCallbackPassCount} `
                        + `callbacks=${callbacks.length} added=${added} elapsed_ms=${Math.round(keyedElapsedMs)} `
                        + `selected=${selected.size}`,
                    );
                }
                if (!changed) break;
            }
        };

        const indexPendingComponentTargets = (): void => {
            const pending: ArkMethod[] = [];
            for (const [signature, method] of selected.entries()) {
                if (componentIndexScanned.has(signature)) continue;
                componentIndexScanned.add(signature);
                pending.push(method);
            }
            if (pending.length === 0) return;
            const componentIndexStartedAt = process.hrtime.bigint();
            const partialIndex = buildComponentEntrypointExpansionIndex(this.scene, {
                methods: pending,
            });
            componentIndexMs += this.elapsedMsSince(componentIndexStartedAt);
            for (const [signature, targets] of partialIndex.entries()) {
                componentEntrypointIndex.set(signature, targets);
            }
            if (pending.length > 100 || partialIndex.size > 0) {
                this.progress(
                    `[ArkMain] entry closure component index pending=${pending.length} `
                    + `indexed=${partialIndex.size} scanned_total=${componentIndexScanned.size}`,
                );
            }
        };

        mergeMethods(methods);
        drainDirectClosure();
        let componentAddedCount = 0;
        const maxRounds = 4;
        for (let round = 0; round < maxRounds; round++) {
            let changed = false;
            indexPendingComponentTargets();
            const componentStartedAt = process.hrtime.bigint();
            for (const signature of [...selected.keys()]) {
                const componentTargets = componentEntrypointIndex.get(signature) || [];
                for (const targetSignature of componentTargets) {
                    if (mergeMethod(methodsBySig.get(targetSignature))) {
                        componentAddedCount++;
                        changed = true;
                    }
                }
            }
            componentExpansionMs += this.elapsedMsSince(componentStartedAt);
            this.progress(
                `[ArkMain] entry closure component round=${round + 1}/${maxRounds} `
                + `changed=${changed ? 1 : 0} selected=${selected.size} component_added=${componentAddedCount}`,
            );
            if (!changed) break;
            drainDirectClosure();
        }
        const expanded = [...selected.values()];
        this.lastPagBuildProfile.arkMainEntryClosureMs = this.elapsedMsSince(startedAt);
        this.lastPagBuildProfile.arkMainEntryClosureComponentIndexMs = componentIndexMs;
        this.lastPagBuildProfile.arkMainEntryClosureDirectExpansionMs = directExpansionMs;
        this.lastPagBuildProfile.arkMainEntryClosureDirectExpansionAttemptCount = directExpansionAttemptCount;
        this.lastPagBuildProfile.arkMainEntryClosureKeyedCallbackMs = keyedCallbackMs;
        this.lastPagBuildProfile.arkMainEntryClosureKeyedCallbackPassCount = keyedCallbackPassCount;
        this.lastPagBuildProfile.arkMainEntryClosureKeyedCallbackAddedCount = keyedCallbackAddedCount;
        this.lastPagBuildProfile.arkMainEntryClosureComponentExpansionMs = componentExpansionMs;
        this.lastPagBuildProfile.arkMainScheduledMethodCount = methods.length;
        this.lastPagBuildProfile.arkMainEntryClosureMethodCount = expanded.length;
        this.lastPagBuildProfile.arkMainEntryClosureComponentAddedCount = componentAddedCount;
        if (this.lastPagBuildProfile.arkMainEntryClosureMs > 500 || expanded.length > methods.length) {
            this.progress(
                `[ArkMain] entry closure scheduled=${methods.length} expanded=${expanded.length} `
                + `component_added=${componentAddedCount} `
                + `elapsed_ms=${Math.round(this.lastPagBuildProfile.arkMainEntryClosureMs)}`,
            );
        }
        return expanded;
    }

    private resolveArkMainScheduledEntryMethods(methods: ArkMethod[]): ArkMethod[] {
        if (this.options.arkMainEntryClosure === "scheduledOnly") {
            const scheduled = this.normalizeSyntheticEntryMethods(methods);
            this.lastPagBuildProfile.arkMainEntryClosureMs = 0;
            this.lastPagBuildProfile.arkMainEntryClosureComponentIndexMs = 0;
            this.lastPagBuildProfile.arkMainScheduledMethodCount = methods.length;
            this.lastPagBuildProfile.arkMainEntryClosureMethodCount = scheduled.length;
            this.lastPagBuildProfile.arkMainEntryClosureComponentAddedCount = 0;
            this.lastPagBuildProfile.arkMainEntryClosureSkipped = 1;
            return scheduled;
        }
        return this.expandArkMainScheduledEntryClosure(methods);
    }

    private normalizeSyntheticEntryMethods(methods?: ArkMethod[]): ArkMethod[] {
        if (!methods || methods.length === 0) return [];
        const dedup = new Map<string, ArkMethod>();
        for (const method of methods) {
            const signature = safeMethodSignatureText(method);
            if (!signature || dedup.has(signature)) continue;
            dedup.set(signature, method);
        }
        return [...dedup.values()];
    }

    private mergeSyntheticEntryMethods(primary: ArkMethod[], extra: ArkMethod[]): ArkMethod[] {
        const dedup = new Map<string, ArkMethod>();
        for (const method of [...primary, ...extra]) {
            const signature = safeMethodSignatureText(method);
            if (!signature || dedup.has(signature)) continue;
            dedup.set(signature, method);
        }
        return [...dedup.values()];
    }

    private createSyntheticEntry(entryModel: EntryModel, entryMethods: ArkMethod[] = []): {
        syntheticRootMethod: any;
        cleanup: () => void;
    } {
        const root = SYNTHETIC_ROOTS[entryModel];
        const builder = new ArkMainSyntheticRootBuilder(this.scene);
        const result = builder.build(entryMethods, {
            fileName: root.fileName,
            className: root.className,
            methodName: root.methodName,
        });
        return {
            syntheticRootMethod: result.method,
            cleanup: result.cleanup,
        };
    }

    public setActiveReachableMethodSignatures(
        methodSignatures?: Set<string>,
        options?: { mergeExplicitEntryScope?: boolean },
    ): void {
        const merged = new Set<string>();
        if (methodSignatures) {
            for (const signature of methodSignatures) {
                merged.add(signature);
            }
        }
        const mergeExplicitEntryScope = options?.mergeExplicitEntryScope !== false;
        if (mergeExplicitEntryScope && this.explicitEntryScopeMethodSignatures) {
            for (const signature of this.explicitEntryScopeMethodSignatures) {
                merged.add(signature);
            }
        }
        if (merged.size === 0) {
            this.activeReachableMethodSignatures = undefined;
            this.refreshModuleRuntime();
            return;
        }
        this.activeReachableMethodSignatures = merged;
        this.refreshModuleRuntime();
    }

    public getActiveReachableMethodSignatures(): Set<string> | undefined {
        if (!this.activeReachableMethodSignatures) return undefined;
        return new Set(this.activeReachableMethodSignatures);
    }

    private shortReachableSignature(signature: string): string {
        if (signature.length <= 96) return signature;
        return `${signature.slice(0, 48)}...${signature.slice(-40)}`;
    }

    private collectContextualDirectCallExpansionTargetSignatures(
        method: ArkMethod,
        thisOwnerContextIndex: Map<string, Set<string>>,
        budget?: BuildStageBudget,
    ): string[] {
        const methodSignature = safeMethodSignatureText(method);
        if (!methodSignature) return [];
        const ownerNames = [...(thisOwnerContextIndex.get(methodSignature) || [])].sort();
        if (ownerNames.length === 0) return [];
        const cfg = method.getCfg?.();
        if (!cfg) return [];

        const out = new Set<string>();
        for (const stmt of cfg.getStmts()) {
            assertBuildStageBudget(budget, `contextual_direct_targets.stmt(${this.shortReachableSignature(methodSignature)})`);
            if (!stmt.containsInvokeExpr?.()) continue;
            const invokeExpr = stmt.getInvokeExpr?.();
            if (!invokeExpr) continue;
            if (!isThisReceiverInvokeForReachability(invokeExpr)) continue;
            for (const ownerName of ownerNames) {
                for (const resolved of resolveCalleeCandidates(this.scene, invokeExpr, {
                    maxNameMatchCandidates: 8,
                    enableDirectCallableTargets: false,
                    thisOwnerNames: [ownerName],
                })) {
                    const targetSignature = safeMethodSignatureText(resolved.method);
                    if (targetSignature) out.add(targetSignature);
                }
            }
        }
        return [...out].sort();
    }

    public computeReachableMethodSignatures(): Set<string> {
        this.lastReachableProfile = {};
        const reachableProfileStart = process.hrtime.bigint();
        const reachableBudget: BuildStageBudget = {
            startedAtMs: Date.now(),
            maxElapsedMs: this.options.debug?.reachableMaxElapsedMs,
            label: "reachable",
        };
        const recordReachableProfile = (key: string, startedAt: bigint): void => {
            this.lastReachableProfile[key] = this.elapsedMsSince(startedAt);
        };
        if (!this.cg) {
            throw new Error("PAG/CG not built. Call buildPAG() first.");
        }
        const syntheticRootFuncId = this.cg.getDummyMainFuncID?.();
        if (syntheticRootFuncId === undefined || syntheticRootFuncId === null) {
            throw new Error("Synthetic root not registered in call graph.");
        }

        const queue: number[] = [syntheticRootFuncId];
        const visited = new Set<number>();
        const reachable = new Set<string>();
        const deferredUnitSignatures = new Set(
            (this.executionHandoffSnapshot?.contracts || [])
                .filter(contract => !!contract.unitSignature)
                .map(contract => contract.unitSignature as string),
        );

        const directCgBfsT0 = process.hrtime.bigint();
        this.progress("[reachable] direct cg bfs start");
        for (let head = 0; head < queue.length; head++) {
            assertBuildStageBudget(reachableBudget, `direct_cg_bfs(head=${head},queue=${queue.length})`);
            const nodeId = queue[head];
            if (visited.has(nodeId)) continue;
            visited.add(nodeId);

            const methodSig = this.cg.getMethodByFuncID(nodeId);
            if (methodSig) {
                const methodSigText = safeValueText(methodSig);
                if (methodSigText) {
                    reachable.add(methodSigText);
                }
            }

            const node = this.cg.getNode(nodeId);
            if (!node) continue;
            for (const edge of node.getOutgoingEdges()) {
                const dstSignature = safeValueText(this.cg.getMethodByFuncID(edge.getDstID()));
                if (dstSignature && deferredUnitSignatures.has(dstSignature)) {
                    continue;
                }
                queue.push(edge.getDstID());
            }
        }
        recordReachableProfile("directCgBfsMs", directCgBfsT0);
        this.lastReachableProfile.directCgVisitedCount = visited.size;
        this.progress(`[reachable] direct cg bfs done visited=${visited.size} reachable=${reachable.size}`);

        const syntheticAdj = new Map<string, Set<string>>();
        const syntheticMaterializedCallers = new Set<string>();
        const syntheticEdgeMergeCursors = new Map<number, number>();
        let syntheticInvokeMaterializeMs = 0;
        let syntheticAdjRefreshMs = 0;
        let syntheticMaterializedCallerCount = 0;

        const materializeSyntheticCaller = (signature: string): boolean => {
            if (!signature || syntheticMaterializedCallers.has(signature)) return false;
            syntheticMaterializedCallers.add(signature);
            if (!this.activePagCacheEntry?.syntheticInvokeLazyMaterializer) return false;
            const startedAt = process.hrtime.bigint();
            materializeSyntheticInvokeSitesForCaller(
                this.scene,
                this.cg,
                this.pag,
                this.syntheticInvokeEdgeMap,
                this.activePagCacheEntry.syntheticInvokeLazyMaterializer,
                signature,
                this.executionHandoffDeferredSiteKeys,
                undefined,
                reachableBudget,
            );
            syntheticInvokeMaterializeMs += this.elapsedMsSince(startedAt);
            syntheticMaterializedCallerCount++;
            return true;
        };

        const mergeSyntheticAdjFromEdges = (mode: "all" | "new" = "new"): void => {
            const startedAt = process.hrtime.bigint();
            for (const [nodeId, edges] of this.syntheticInvokeEdgeMap.entries()) {
                assertBuildStageBudget(reachableBudget, "synthetic_adj.edges");
                const startIndex = mode === "all" ? 0 : (syntheticEdgeMergeCursors.get(nodeId) || 0);
                for (let edgeIndex = startIndex; edgeIndex < edges.length; edgeIndex += 1) {
                    const edge = edges[edgeIndex];
                    if (edge.type !== CallEdgeType.CALL) continue;
                    if (!edge.callerSignature || !edge.calleeSignature) continue;
                    if (!syntheticAdj.has(edge.callerSignature)) {
                        syntheticAdj.set(edge.callerSignature, new Set());
                    }
                    syntheticAdj.get(edge.callerSignature)!.add(edge.calleeSignature);
                }
                syntheticEdgeMergeCursors.set(nodeId, edges.length);
            }
            syntheticAdjRefreshMs += this.elapsedMsSince(startedAt);
        };

        const ensureSyntheticAdjForCaller = (signature: string): void => {
            const materializedNow = materializeSyntheticCaller(signature);
            if (!materializedNow) return;
            mergeSyntheticAdjFromEdges("new");
        };

        const syntheticMaterializeT0 = process.hrtime.bigint();
        this.progress("[reachable] synthetic materialize start");
        assertBuildStageBudget(reachableBudget, "synthetic_materialize.start");
        for (const signature of reachable) {
            materializeSyntheticCaller(signature);
        }
        assertBuildStageBudget(reachableBudget, "synthetic_materialize.done");
        recordReachableProfile("syntheticInvokeMaterializeMs", syntheticMaterializeT0);
        this.lastReachableProfile.syntheticInvokeMaterializeCallerCount = syntheticMaterializedCallerCount;
        this.progress(`[reachable] synthetic materialize done callers=${syntheticMaterializedCallerCount}`);
        this.progress("[reachable] synthetic adjacency build start");
        const syntheticAdjT0 = process.hrtime.bigint();
        mergeSyntheticAdjFromEdges("all");
        recordReachableProfile("syntheticAdjBuildMs", syntheticAdjT0);
        this.lastReachableProfile.syntheticAdjRefreshMs = syntheticAdjRefreshMs;
        this.progress(`[reachable] synthetic adjacency build done callers=${syntheticAdj.size}`);
        const syntheticQueue = [...reachable];
        const syntheticVisited = new Set<string>(reachable);
        const syntheticBfsT0 = process.hrtime.bigint();
        this.progress(`[reachable] synthetic bfs start initial=${syntheticQueue.length}`);
        for (let head = 0; head < syntheticQueue.length; head++) {
            assertBuildStageBudget(reachableBudget, `synthetic_bfs(head=${head},queue=${syntheticQueue.length})`);
            const sig = syntheticQueue[head];
            ensureSyntheticAdjForCaller(sig);
            const callees = syntheticAdj.get(sig);
            if (!callees) continue;
            for (const callee of callees) {
                if (syntheticVisited.has(callee)) continue;
                syntheticVisited.add(callee);
                reachable.add(callee);
                syntheticQueue.push(callee);
                ensureSyntheticAdjForCaller(callee);
            }
        }
        recordReachableProfile("syntheticBfsMs", syntheticBfsT0);
        this.progress(`[reachable] synthetic bfs done visited=${syntheticVisited.size} reachable=${reachable.size}`);

        const methodsBySigT0 = process.hrtime.bigint();
        this.progress("[reachable] methods by signature start");
        assertBuildStageBudget(reachableBudget, "methods_by_sig");
        const methodsBySig = this.getMethodsBySignature();
        recordReachableProfile("methodsBySigMs", methodsBySigT0);
        this.progress(`[reachable] methods by signature done count=${methodsBySig.size}`);

        const directReachabilityExpansionEnabled = this.options.reachabilityDirectExpansion !== "disabled";
        this.progress(
            `[reachable] direct expansion ${directReachabilityExpansionEnabled ? "enabled" : "disabled"} `
            + `mode=${this.options.arkMainEntryClosure === "scheduledOnly" ? "candidate_scheduled_entry" : "full"}`,
        );
        const fixedPointT0 = process.hrtime.bigint();
        const componentIndexT0 = process.hrtime.bigint();
        this.progress("[reachable] component entrypoint index start");
        assertBuildStageBudget(reachableBudget, "component_entrypoint_index.start");
        const componentSeedMethods = directReachabilityExpansionEnabled
            ? [...reachable]
                .map(signature => methodsBySig.get(signature))
                .filter((method): method is ArkMethod => !!method)
            : [];
        const componentEntrypointIndex = buildComponentEntrypointExpansionIndex(this.scene, {
            methods: componentSeedMethods,
            progress: msg => this.progress(`[reachable] ${msg}`),
            progressInterval: 100,
        });
        assertBuildStageBudget(reachableBudget, "component_entrypoint_index.done");
        recordReachableProfile("componentEntrypointIndexMs", componentIndexT0);
        this.progress(`[reachable] component entrypoint index done seeds=${componentSeedMethods.length} owners=${componentEntrypointIndex.size}`);
        const thisOwnerContextIndexT0 = process.hrtime.bigint();
        const reusedThisOwnerContextIndex = directReachabilityExpansionEnabled
            ? this.syntheticInvokeLazyMaterializer?.lookupContext.thisOwnerNamesByMethodSignature
            : undefined;
        const thisOwnerSeedMethods = directReachabilityExpansionEnabled
            ? [...reachable]
                .map(signature => methodsBySig.get(signature))
                .filter((method): method is ArkMethod => !!method)
            : [];
        if (directReachabilityExpansionEnabled && !reusedThisOwnerContextIndex) {
            this.progress(`[reachable] this owner context index build start seeds=${thisOwnerSeedMethods.length}`);
        }
        const thisOwnerContextIndex = directReachabilityExpansionEnabled
            ? (reusedThisOwnerContextIndex || buildMethodThisOwnerContextIndex(this.scene, thisOwnerSeedMethods, {
                budget: reachableBudget,
                log: msg => this.progress(`[reachable] ${msg}`),
                progressInterval: 200,
            }))
            : new Map<string, Set<string>>();
        recordReachableProfile("thisOwnerContextIndexMs", thisOwnerContextIndexT0);
        this.lastReachableProfile.directExpansionDisabled = directReachabilityExpansionEnabled ? 0 : 1;
        this.progress(
            directReachabilityExpansionEnabled
                ? `[reachable] this owner context index ${reusedThisOwnerContextIndex ? "reused" : "built"} methods=${thisOwnerContextIndex.size}`
                : "[reachable] this owner context index skipped because direct expansion is disabled",
        );

        const directTargetsCache = new Map<string, string[]>();
        const frameworkCallbackCache = new Map<string, string[]>();
        const ordinaryCallbackCache = new Map<string, string[]>();
        let directExpansionMs = 0;
        let componentExpansionMs = 0;
        let syntheticFixedPointExpansionMs = 0;
        let frameworkCallbackMs = 0;
        let ordinaryCallbackMs = 0;
        let expansionAddedCount = 0;
        let syntheticFixedPointExpansionAddedCount = 0;
        let directExpansionAttemptCount = 0;

        const getDirectTargets = (signature: string): string[] => {
            const cached = directTargetsCache.get(signature);
            if (cached) return cached;
            const method = methodsBySig.get(signature);
            if (!method) {
                directTargetsCache.set(signature, []);
                return [];
            }
            directExpansionAttemptCount++;
            const shortSignature = this.shortReachableSignature(signature);
            if (directExpansionAttemptCount === 1 || directExpansionAttemptCount % 100 === 0) {
                this.progress(
                    `[reachable] direct expansion resolving method #${directExpansionAttemptCount} `
                    + `current=${shortSignature}`,
                );
            }
            const startedAt = process.hrtime.bigint();
            assertBuildStageBudget(reachableBudget, `direct_targets.start(${shortSignature})`);
            const targets = new Set(collectDirectCallExpansionTargetMethods(this.scene, method, {
                includeKeyedDispatchCallbacks: false,
                budget: reachableBudget,
                budgetLabel: shortSignature,
            })
                .map(target => safeMethodSignatureText(target))
                .filter((target): target is string => !!target));
            for (const target of this.collectContextualDirectCallExpansionTargetSignatures(method, thisOwnerContextIndex, reachableBudget)) {
                targets.add(target);
            }
            const sortedTargets = [...targets].sort();
            assertBuildStageBudget(reachableBudget, `direct_targets.done(count=${sortedTargets.length},sig=${shortSignature})`);
            const elapsedMs = this.elapsedMsSince(startedAt);
            directExpansionMs += elapsedMs;
            if (elapsedMs > 5000 || directExpansionAttemptCount % 100 === 0) {
                this.progress(
                    `[reachable] direct expansion resolved method #${directExpansionAttemptCount} `
                    + `targets=${sortedTargets.length} elapsed_ms=${Math.round(elapsedMs)} current=${shortSignature}`,
                );
            }
            directTargetsCache.set(signature, sortedTargets);
            return sortedTargets;
        };

        const getFrameworkCallbackTargets = (signature: string): string[] => {
            const cached = frameworkCallbackCache.get(signature);
            if (cached) return cached;
            const method = methodsBySig.get(signature);
            if (!method) {
                frameworkCallbackCache.set(signature, []);
                return [];
            }
            const startedAt = process.hrtime.bigint();
            assertBuildStageBudget(reachableBudget, `framework_callback_targets.start(${this.shortReachableSignature(signature)})`);
            const targets = collectKnownFrameworkCallbackMethodSignaturesFromMethod(this.scene, method);
            assertBuildStageBudget(reachableBudget, `framework_callback_targets.done(count=${targets.length},sig=${this.shortReachableSignature(signature)})`);
            frameworkCallbackMs += this.elapsedMsSince(startedAt);
            frameworkCallbackCache.set(signature, targets);
            return targets;
        };

        const getOrdinaryCallbackTargets = (signature: string): string[] => {
            const cached = ordinaryCallbackCache.get(signature);
            if (cached) return cached;
            const method = methodsBySig.get(signature);
            if (!method) {
                ordinaryCallbackCache.set(signature, []);
                return [];
            }
            const startedAt = process.hrtime.bigint();
            assertBuildStageBudget(reachableBudget, `ordinary_callback_targets.start(${this.shortReachableSignature(signature)})`);
            const targets = collectOrdinaryHigherOrderCallbackMethodSignaturesFromMethod(this.scene, method);
            assertBuildStageBudget(reachableBudget, `ordinary_callback_targets.done(count=${targets.length},sig=${this.shortReachableSignature(signature)})`);
            ordinaryCallbackMs += this.elapsedMsSince(startedAt);
            ordinaryCallbackCache.set(signature, targets);
            return targets;
        };

        const expansionQueue = [...reachable];
        const expanded = new Set<string>();
        const enqueueReachable = (signature: string): boolean => {
            if (!signature || reachable.has(signature)) return false;
            reachable.add(signature);
            expansionQueue.push(signature);
            expansionAddedCount++;
            return true;
        };

        this.progress(`[reachable] fixed point start queue=${expansionQueue.length} reachable=${reachable.size}`);
        for (let head = 0; head < expansionQueue.length; head++) {
            assertBuildStageBudget(reachableBudget, `fixed_point(head=${head},queue=${expansionQueue.length},reachable=${reachable.size})`);
            if (head > 0 && head % 100 === 0) {
                this.progress(
                    `[reachable] fixed point progress head=${head} queue=${expansionQueue.length} reachable=${reachable.size} `
                    + `expanded=${expanded.size} synthetic_ms=${syntheticFixedPointExpansionMs.toFixed(1)} `
                    + `direct_ms=${directExpansionMs.toFixed(1)} `
                    + `callback_ms=${(frameworkCallbackMs + ordinaryCallbackMs).toFixed(1)}`,
                );
            }
            const signature = expansionQueue[head];
            if (expanded.has(signature)) continue;
            expanded.add(signature);

            const syntheticStartedAt = process.hrtime.bigint();
            ensureSyntheticAdjForCaller(signature);
            const syntheticTargets = syntheticAdj.get(signature) || [];
            for (const target of syntheticTargets) {
                if (enqueueReachable(target)) {
                    syntheticFixedPointExpansionAddedCount++;
                    ensureSyntheticAdjForCaller(target);
                }
            }
            syntheticFixedPointExpansionMs += this.elapsedMsSince(syntheticStartedAt);

            if (directReachabilityExpansionEnabled) {
                for (const target of getDirectTargets(signature)) {
                    enqueueReachable(target);
                }
            }

            const componentStartedAt = process.hrtime.bigint();
            const componentTargets = componentEntrypointIndex.get(signature) || [];
            componentExpansionMs += this.elapsedMsSince(componentStartedAt);
            for (const target of componentTargets) {
                enqueueReachable(target);
            }

            for (const callbackSignature of getFrameworkCallbackTargets(signature)) {
                enqueueReachable(callbackSignature);
            }

            for (const callbackSignature of getOrdinaryCallbackTargets(signature)) {
                enqueueReachable(callbackSignature);
            }
        }
        this.progress(`[reachable] fixed point done expanded=${expanded.size} reachable=${reachable.size} added=${expansionAddedCount}`);
        this.lastReachableProfile.syntheticInvokeMaterializeTotalMs = syntheticInvokeMaterializeMs;
        this.lastReachableProfile.syntheticInvokeMaterializeCallerCount = syntheticMaterializedCallerCount;
        this.lastReachableProfile.syntheticAdjRefreshMs = syntheticAdjRefreshMs;
        this.lastReachableProfile.syntheticAdjRefreshedCallerCount = syntheticAdj.size;
        this.lastReachableProfile.directExpansionFirstPassMs = directExpansionMs;
        this.lastReachableProfile.frameworkCallbackIndexMs = 0;
        this.lastReachableProfile.frameworkCallbackBfsMs = frameworkCallbackMs;
        this.lastReachableProfile.ordinaryCallbackBfsMs = ordinaryCallbackMs;
        this.lastReachableProfile.componentEntrypointExpansionMs = componentExpansionMs;
        this.lastReachableProfile.syntheticFixedPointExpansionMs = syntheticFixedPointExpansionMs;
        this.lastReachableProfile.syntheticFixedPointExpansionAddedCount = syntheticFixedPointExpansionAddedCount;
        this.lastReachableProfile.incrementalExpandedMethodCount = expanded.size;
        this.lastReachableProfile.incrementalExpansionAddedCount = expansionAddedCount;
        recordReachableProfile("fixedPointExpansionMs", fixedPointT0);
        this.lastReachableProfile.totalMs = this.elapsedMsSince(reachableProfileStart);
        this.lastReachableProfile.reachableCount = reachable.size;

        return reachable;
    }

    public propagate(sourceSignature: string): void {
        if (!this.pag || !this.cg) {
            throw new Error("PAG not built. Call buildPAG() first.");
        }
        this.observedFacts.clear();
        this.lastEnginePluginFindings = [];

        this.log(`\n=== Propagating taint from source: "${sourceSignature}" ===`);
        const worklist: TaintFact[] = [];
        const visited = new Set<string>();
        let sourcesFound = 0;
        const emptyCtx = this.ctxManager.getEmptyContextID();

        for (const method of this.scene.getMethods()) {
            const cfg = method.getCfg();
            if (!cfg) continue;

            this.log(`Checking method "${method.getName()}"...`);
            for (const stmt of cfg.getStmts()) {
                if (!stmt.containsInvokeExpr()) continue;

                const invokeExpr = stmt.getInvokeExpr();
                if (!invokeExpr) continue;

                const calleeSignature = invokeExpr.getMethodSignature().toString();
                this.log(`  Found call to: ${calleeSignature}`);

                if (!calleeSignature.includes(sourceSignature)) continue;
                this.log("  *** MATCH! Found source call ***");
                sourcesFound++;

                if (!(stmt instanceof ArkAssignStmt)) continue;

                const leftOp = stmt.getLeftOp();
                const pagNodes = this.pag.getNodesByValue(leftOp);
                if (!pagNodes || pagNodes.size === 0) continue;

                const nodeId = pagNodes.values().next().value as number;
                const node = this.pag.getNode(nodeId) as PagNode;
                const fact = new TaintFact(node, sourceSignature, emptyCtx);
                worklist.push(fact);
                this.tracker.markTainted(nodeId, emptyCtx, sourceSignature, undefined, fact.taintId);
                this.upsertFactRuleChain(fact.taintId, this.initialFlowRuleChainForFact(fact));
                this.log(`  Added taint fact for node ${nodeId}`);
            }
        }

        this.log(`Found ${sourcesFound} source(s)`);
        if (sourcesFound === 0) {
            this.log("WARNING: No sources found!");
            return;
        }

        this.log(`\nStarting WorkList propagation with ${worklist.length} initial facts...`);
        this.runWorkList(worklist, visited);
        this.log(`Propagation complete. Processed ${visited.size} facts.`);
    }

    public propagateWithSeeds(seeds: PagNode[]): void {
        const emptyCtx = this.ctxManager.getEmptyContextID();
        const seedFacts = seeds.map(seed => new TaintFact(seed, "entry_arg", emptyCtx));
        this.propagateWithFacts(seedFacts);
    }

    private propagateWithFacts(seedFacts: TaintFact[]): void {
        this.resetPropagationState();
        const worklist: TaintFact[] = [];
        const visited: Set<string> = new Set();
        for (const fact of seedFacts) {
            if (visited.has(fact.taintId)) continue;
            visited.add(fact.taintId);
            worklist.push(fact);
            this.tracker.markTainted(fact.node.getID(), fact.contextID, fact.source, fact.field, fact.taintId);
            this.upsertFactRuleChain(fact.taintId, this.initialFlowRuleChainForFact(fact));
            this.traceGraph?.recordAuditGate({
                label: fact.source,
                toFact: fact.taintId,
                stage: "source_seed",
                producer: "rule",
                gateKind: "seed",
                scope: "initial_seed_fact",
                attempted: true,
                matched: true,
                emitted: true,
                evidence: {
                    nodeId: fact.node.getID(),
                    contextId: fact.contextID,
                    fieldPath: fact.field ? [...fact.field] : undefined,
                },
            });
        }

        this.log(`Initialized WorkList with ${worklist.length} seeds.`);
        this.runWorkList(worklist, visited);
    }

    public propagateWithSourceRules(
        sourceRules: SourceRule[]
    ): {
        seedCount: number;
        seededLocals: string[];
        sourceRuleHits: Record<string, number>;
        sourceSeedAudit: SourceRuleSeedAuditEntry[];
        sourceRuleZeroHitAudit: SourceRuleZeroHitAuditEntry[];
        endpointResolutionAudit: EndpointResolutionLedgerItem[];
    } {
        this.lastSourceRulePropagationProfile = {};
        const profileStart = process.hrtime.bigint();
        const recordProfile = (key: string, startedAt: bigint): void => {
            this.lastSourceRulePropagationProfile[key] = this.elapsedMsSince(startedAt);
        };
        this.clearRuleHits("source");
        const normalizeT0 = process.hrtime.bigint();
        const effectiveSourceRules = this.mergeAutoEntrySourceRules([
            ...this.normalizeRuntimeSourceRules(sourceRules || [], "runtime_project"),
        ]);
        recordProfile("normalizeAndMergeMs", normalizeT0);
        this.lastSourceRulePropagationProfile.effectiveRuleCount = effectiveSourceRules.length;
        const collectT0 = process.hrtime.bigint();
        const exactSemanticSourceRules = this.options.semanticAssetReachabilityScope === "allExactSites"
            ? effectiveSourceRules.filter(rule => this.isEvaluationSemanticAssetRule(rule))
            : [];
        const reachableSourceRules = exactSemanticSourceRules.length === 0
            ? effectiveSourceRules
            : effectiveSourceRules.filter(rule => !this.isEvaluationSemanticAssetRule(rule));
        let ruleSeeds = this.collectSourceRuleSeedsToFixedPoint(
            reachableSourceRules,
            this.activeReachableMethodSignatures,
        );
        if (exactSemanticSourceRules.length > 0) {
            const exactSemanticSeeds = this.collectSourceRuleSeedsToFixedPoint(
                exactSemanticSourceRules,
                undefined,
            );
            ruleSeeds = mergeSourceRuleSeedCollectionResults(ruleSeeds, exactSemanticSeeds);
        }
        this.recordSourceSeedAuditGates(ruleSeeds.sourceSeedAudit);
        this.recordSourceRuleZeroHitGates(
            effectiveSourceRules,
            ruleSeeds.sourceRuleHits,
            ruleSeeds.passCount,
            ruleSeeds.activatedMethodSignatures.length,
            ruleSeeds.sourceRuleZeroHitAudit,
        );
        recordProfile("collectSeedsMs", collectT0);
        this.lastSourceRulePropagationProfile.rawSeedFactCount = ruleSeeds.facts.length;
        this.lastSourceRulePropagationProfile.activatedMethodCount = ruleSeeds.activatedMethodSignatures.length;
        this.lastSourceRulePropagationProfile.collectionPassCount = ruleSeeds.passCount;
        const invalidationT0 = process.hrtime.bigint();
        this.invalidateModuleRuntimeAfterPagMutation();
        recordProfile("invalidateModuleRuntimeMs", invalidationT0);
        if (ruleSeeds.activatedMethodSignatures.length > 0) {
            const reachableMergeT0 = process.hrtime.bigint();
            const mergedReachable = new Set<string>(this.activeReachableMethodSignatures || []);
            for (const sig of ruleSeeds.activatedMethodSignatures) {
                mergedReachable.add(sig);
            }
            // NOTE: flow-insensitive propagation does not model event-loop ordering.
            // We expand reachable methods to activate callback bodies discovered at registration sites.
            this.setActiveReachableMethodSignatures(mergedReachable);
            recordProfile("reachableMergeMs", reachableMergeT0);
        }
        const factMergeT0 = process.hrtime.bigint();
        const mergedFacts = new Map<string, TaintFact>();
        for (const fact of ruleSeeds.facts) {
            if (!mergedFacts.has(fact.taintId)) {
                mergedFacts.set(fact.taintId, fact);
            }
        }
        const seededLocals = new Set<string>(ruleSeeds.seededLocals);
        recordProfile("deduplicateSeedsMs", factMergeT0);

        const markHitsT0 = process.hrtime.bigint();
        for (const [ruleId, hitCount] of Object.entries(ruleSeeds.sourceRuleHits)) {
            this.markRuleHit("source", ruleId, Number(hitCount) || 0);
        }
        recordProfile("markSourceHitsMs", markHitsT0);
        if (mergedFacts.size === 0) {
            this.traceGraph?.recordAuditGate({
                stage: "source_seed",
                producer: "rule",
                gateKind: "seed",
                scope: "source_rule_collection",
                attempted: true,
                matched: false,
                emitted: false,
                skippedReason: "no_source_seed_matches",
                evidence: {
                    effectiveRuleCount: effectiveSourceRules.length,
                    activatedMethodCount: ruleSeeds.activatedMethodSignatures.length,
                    passCount: ruleSeeds.passCount,
                },
            });
            this.log("No source seeds matched by source rules.");
            this.lastSourceRulePropagationProfile.totalMs = this.elapsedMsSince(profileStart);
            this.lastSourceRulePropagationProfile.seedCount = 0;
            return {
                seedCount: 0,
                seededLocals: [],
                sourceRuleHits: this.toRecord(this.ruleHits.source),
                sourceSeedAudit: [],
                sourceRuleZeroHitAudit: ruleSeeds.sourceRuleZeroHitAudit,
                endpointResolutionAudit: ruleSeeds.endpointResolutionAudit,
            };
        }

        this.log(`Initialized WorkList with ${mergedFacts.size} source-rule seeds.`);
        this.progress(`[source-seed] worklist propagation start seeds=${mergedFacts.size}`);
        const sourceHitEntries = Object.entries(ruleSeeds.sourceRuleHits);
        const initialPropagationT0 = process.hrtime.bigint();
        this.propagateWithFacts(Array.from(mergedFacts.values()));
        recordProfile("initialPropagationMs", initialPropagationT0);
        this.progress(`[source-seed] worklist propagation done elapsed_ms=${Math.round(this.lastSourceRulePropagationProfile.initialPropagationMs || 0)}`);
        const finalHitMarkT0 = process.hrtime.bigint();
        for (const [ruleId, hitCount] of sourceHitEntries) {
            this.markRuleHit("source", ruleId, Number(hitCount) || 0);
        }
        recordProfile("finalMarkSourceHitsMs", finalHitMarkT0);
        this.lastSourceRulePropagationProfile.totalMs = this.elapsedMsSince(profileStart);
        this.lastSourceRulePropagationProfile.seedCount = mergedFacts.size;
        return {
            seedCount: mergedFacts.size,
            seededLocals: [...seededLocals].sort(),
            sourceRuleHits: this.toRecord(this.ruleHits.source),
            sourceSeedAudit: ruleSeeds.sourceSeedAudit,
            sourceRuleZeroHitAudit: ruleSeeds.sourceRuleZeroHitAudit,
            endpointResolutionAudit: ruleSeeds.endpointResolutionAudit,
        };
    }

    private invalidateModuleRuntimeAfterPagMutation(): void {
        this.moduleRuntime = undefined;
        this.moduleRuntimeKey = undefined;
        this.moduleRuntimePag = undefined;
    }

    private recordSourceSeedAuditGates(audit: SourceRuleSeedAuditEntry[]): void {
        if (!this.traceGraph) return;
        for (const entry of audit) {
            this.traceGraph.recordAuditGate({
                label: entry.source,
                toFact: entry.factId,
                stage: "source_seed",
                producer: "rule",
                gateKind: "seed",
                scope: `source_rule:${entry.ruleId}`,
                attempted: true,
                matched: true,
                emitted: true,
                evidence: {
                    ruleId: entry.ruleId,
                    nodeId: entry.nodeId,
                    contextId: entry.contextId,
                    fieldPath: entry.fieldPath,
                    label: entry.label,
                },
            });
        }
    }

    private recordSourceRuleZeroHitGates(
        sourceRules: SourceRule[],
        sourceRuleHits: Record<string, number>,
        passCount: number,
        activatedMethodCount: number,
        zeroHitAudit: SourceRuleZeroHitAuditEntry[] = [],
    ): void {
        if (!this.traceGraph) return;
        const seenRuleIds = new Set<string>();
        const zeroHitAuditByRuleId = new Map(zeroHitAudit.map(entry => [entry.ruleId, entry]));
        for (const rule of sourceRules || []) {
            const ruleId = typeof rule?.id === "string" ? rule.id.trim() : "";
            if (!ruleId || seenRuleIds.has(ruleId)) continue;
            seenRuleIds.add(ruleId);
            if (rule.enabled === false) continue;
            if ((Number(sourceRuleHits[ruleId]) || 0) > 0) continue;
            const diagnostic = zeroHitAuditByRuleId.get(ruleId);

            this.traceGraph.recordAuditGate({
                label: `source_rule:${ruleId}`,
                stage: "source_seed",
                producer: "rule",
                gateKind: "seed",
                scope: `source_rule:${ruleId}`,
                attempted: true,
                matched: false,
                emitted: false,
                skippedReason: "source_rule_zero_hit",
                evidence: {
                    ruleId,
                    sourceKind: rule.sourceKind,
                    match: rule.match,
                    target: rule.target,
                    endpoint: (rule as any).endpoint,
                    effectiveRuleCount: sourceRules.length,
                    activatedMethodCount,
                    passCount,
                    zeroHitReason: diagnostic?.reason,
                    allowedMethodFilterActive: diagnostic?.allowedMethodFilterActive,
                    matchedCallsiteCount: diagnostic?.matchedCallsiteCount,
                    matchedAllowedCallsiteCount: diagnostic?.matchedAllowedCallsiteCount,
                    matchedExcludedCallsiteCount: diagnostic?.matchedExcludedCallsiteCount,
                    sampleCallsites: diagnostic?.sampleCallsites,
                },
            });
        }
    }

    private recordModuleAuditTraceGates(): void {
        if (!this.traceGraph) return;
        const snapshot = this.getModuleAuditSnapshot();
        for (const moduleId of snapshot.loadedModuleIds || []) {
            const stats = snapshot.moduleStats[moduleId];
            this.traceGraph.recordAuditGate({
                stage: "asset_lowering",
                producer: "asset",
                gateKind: "asset_lowering",
                scope: `module_loaded:${moduleId}`,
                attempted: true,
                matched: true,
                emitted: true,
                evidence: {
                    moduleId,
                    sourcePath: stats?.sourcePath,
                },
            });
        }
        for (const failure of snapshot.failureEvents || []) {
            this.traceGraph.recordAuditGate({
                stage: "asset_lowering",
                producer: "asset",
                gateKind: "asset_lowering",
                scope: `module_failure:${failure.moduleId}:${failure.phase}`,
                attempted: true,
                matched: false,
                emitted: false,
                blockedReason: failure.code || failure.phase || "module_failure",
                evidence: {
                    ...failure,
                },
            });
        }
        for (const [moduleId, stats] of Object.entries(snapshot.moduleStats || {})) {
            const hookCounts = [
                { hook: "onFact", calls: stats.factHookCalls, emissions: stats.factEmissionCount, elapsedMs: stats.factHookMs },
                { hook: "onInvoke", calls: stats.invokeHookCalls, emissions: stats.invokeEmissionCount, elapsedMs: stats.invokeHookMs },
                { hook: "shouldSkipCopyEdge", calls: stats.copyEdgeChecks, emissions: stats.skipCopyEdgeCount, elapsedMs: stats.copyEdgeMs },
            ];
            for (const hook of hookCounts) {
                if (hook.calls <= 0 && hook.emissions <= 0) continue;
                this.traceGraph.recordAuditGate({
                    stage: hook.hook === "shouldSkipCopyEdge" ? "module" : "module_lowering",
                    producer: "module",
                    gateKind: hook.hook === "shouldSkipCopyEdge" ? "propagation" : "effect",
                    scope: `module_hook:${moduleId}:${hook.hook}`,
                    attempted: hook.calls > 0,
                    matched: hook.emissions > 0 || hook.hook === "shouldSkipCopyEdge",
                    emitted: hook.emissions > 0,
                    skippedReason: hook.calls > 0 && hook.emissions === 0 ? "module_hook_no_emission" : undefined,
                    evidence: {
                        moduleId,
                        hook: hook.hook,
                        calls: hook.calls,
                        emissions: hook.emissions,
                        elapsedMs: hook.elapsedMs,
                        debugHitCount: stats.debugHitCount,
                        debugSkipCount: stats.debugSkipCount,
                        debugLogCount: stats.debugLogCount,
                        recentDebugMessages: stats.recentDebugMessages,
                    },
                });
            }
            for (const sample of stats.emissionSamples || []) {
                this.traceGraph.recordAuditGate({
                    label: sample.source,
                    fromFact: sample.sourceFactId,
                    toFact: sample.targetFactId,
                    stage: "module",
                    producer: "module",
                    gateKind: "effect",
                    scope: `module_emission:${moduleId}:${sample.hook}:${sample.reason}`,
                    attempted: true,
                    matched: true,
                    emitted: true,
                    evidence: {
                        ...sample,
                    },
                });
            }
        }
    }

    public getAutoEntrySourceRules(): SourceRule[] {
        return this.autoEntrySourceRules.map(rule => {
            const ref = normalizeEndpoint(rule.target);
            const target: RuleEndpointOrRef =
                ref.path === undefined && ref.pathFrom === undefined && ref.slotKind === undefined
                    ? ref.endpoint
                    : { ...ref };
            return {
                ...rule,
                tags: rule.tags ? [...rule.tags] : undefined,
                target,
            };
        });
    }

    public detectSinksByRules(
        sinkRules: SinkRule[],
        options?: {
            stopOnFirstFlow?: boolean;
            maxFlowsPerEntry?: number;
            sanitizerRules?: SanitizerRule[];
        }
    ): TaintFlow[] {
        this.clearRuleHits("sink");
        const effectiveSinkRules = this.orderRulesByFamily([
            ...this.normalizeRuntimeSinkRules(sinkRules || [], "runtime_project"),
        ]);
        const effectiveSanitizerRules = this.orderRulesByFamily([
            ...this.normalizeRuntimeSanitizerRules(options?.sanitizerRules || [], "runtime_project"),
        ]);
        const detectionInput = {
            sinkRules: effectiveSinkRules,
            sanitizerRules: effectiveSanitizerRules,
            stopOnFirstFlow: options?.stopOnFirstFlow,
            maxFlowsPerEntry: options?.maxFlowsPerEntry,
        };
        const detectionContext = this.buildEnginePluginDetectionContext(effectiveSanitizerRules);
        const detected = this.enginePluginRuntime.runDetection(
            detectionInput,
            detectionContext,
            {
                run: (input) => this.detectSinksByRulesCore([...input.sinkRules], {
                    stopOnFirstFlow: input.stopOnFirstFlow,
                    maxFlowsPerEntry: input.maxFlowsPerEntry,
                    sanitizerRules: [...input.sanitizerRules],
                }),
            },
        );
        const finalized = this.enginePluginRuntime.applyResultHooks(detected);
        this.lastEnginePluginFindings = [...finalized];
        for (const flow of finalized) {
            this.traceGraph?.recordSinkFlow(flow);
        }
        return finalized;
    }

    public materializeDetectedSinkFlows(
        sinkRules: SinkRule[],
        options?: {
            stopOnFirstFlow?: boolean;
            maxFlowsPerEntry?: number;
            sanitizerRules?: SanitizerRule[];
            materialize?: PathMaterializationOptions;
        }
    ): {
        flows: TaintFlow[];
        materialized: MaterializedTaintFlow[];
    } {
        const flows = this.detectSinksByRules(sinkRules, {
            stopOnFirstFlow: options?.stopOnFirstFlow,
            maxFlowsPerEntry: options?.maxFlowsPerEntry,
            sanitizerRules: options?.sanitizerRules,
        });
        return this.materializeDetectedSinkFlowPaths(flows, options?.materialize);
    }

    public materializeDetectedSinkFlowPaths(
        flows: TaintFlow[],
        materializeOptions?: PathMaterializationOptions,
    ): {
        flows: TaintFlow[];
        materialized: MaterializedTaintFlow[];
    } {
        const context = this.buildPostsolveContext();
        const materialized: MaterializedTaintFlow[] = [];
        for (const flow of flows) {
            const item = materializeTaintFlowPaths(flow, context, materializeOptions);
            if (item) {
                materialized.push(item);
                this.traceGraph?.recordAuditGate({
                    label: flow.source,
                    toFact: flow.sinkFactId,
                    stage: "provenance",
                    producer: "provenance",
                    gateKind: "path_materialization",
                    scope: `path_materialization:${flow.sinkFactId || flow.toString()}`,
                    attempted: true,
                    matched: true,
                    emitted: item.materializationStatus === "complete" || item.materializationStatus === "bounded-complete",
                    skippedReason: item.materializationStatus === "truncated" ? "truncated_materialization" : undefined,
                    blockedReason: item.materializationStatus === "failed" || item.materializationStatus === "incomplete"
                        ? item.incompleteReasons[0] || item.materializationStatus
                        : undefined,
                    evidence: {
                        sink: flow.sink.toString(),
                        sinkFactId: flow.sinkFactId,
                        status: item.status,
                        materializationStatus: item.materializationStatus,
                        incompleteReasons: item.incompleteReasons,
                        pathCount: item.paths.length,
                        pathClassCount: item.pathClasses?.length || 0,
                        gapCount: item.gaps?.length || 0,
                    },
                });
            } else {
                this.traceGraph?.recordAuditGate({
                    label: flow.source,
                    toFact: flow.sinkFactId,
                    stage: "provenance",
                    producer: "provenance",
                    gateKind: "path_materialization",
                    scope: `path_materialization:${flow.sinkFactId || flow.toString()}`,
                    attempted: true,
                    matched: false,
                    emitted: false,
                    blockedReason: "materialization_failed",
                    evidence: {
                        sink: flow.sink.toString(),
                        sinkFactId: flow.sinkFactId,
                    },
                });
            }
        }
        return { flows, materialized };
    }

    public evaluatePostsolveFlowResults(
        flows: TaintFlow[],
        options?: {
            sanitizerRules?: SanitizerRule[];
            materialize?: PathMaterializationOptions;
        },
    ): {
        results: PostsolveFlowResult[];
        suppressed: PostsolveFlowResult[];
        survivingFlows: TaintFlow[];
    } {
        const context = this.buildPostsolveContext(options);
        const results: PostsolveFlowResult[] = [];
        const suppressed: PostsolveFlowResult[] = [];
        const survivingFlows: TaintFlow[] = [];

        for (const flow of flows) {
            const seedResult = evaluatePostsolveFlow(flow, context);
            const flowResult = materializePostsolveFlowResult(flow, seedResult);
            results.push(flowResult);
            this.traceGraph?.recordPostsolveDecision({
                flowId: flow.toString(),
                sinkFactId: flow.sinkFactId,
                label: flow.source,
                judgement: flowResult.judgement.kind,
                reason: `postsolve:${flowResult.judgement.kind}`,
                evidence: {
                    sink: flow.sink.toString(),
                    evidenceKinds: flowResult.evidenceSummary.evidenceKinds,
                },
            });
            if (flowResult.judgement.kind === "Refuted-Strong") {
                this.traceGraph?.recordAuditGate({
                    label: flow.source,
                    toFact: flow.sinkFactId,
                    stage: "reporting",
                    producer: "reporting",
                    gateKind: "report_emission",
                    scope: `reporting:${flow.sinkFactId || flow.toString()}`,
                    attempted: true,
                    matched: true,
                    emitted: false,
                    blockedReason: "postsolve_refuted_strong",
                    evidence: {
                        sink: flow.sink.toString(),
                        judgement: flowResult.judgement.kind,
                    },
                });
                suppressed.push(flowResult);
                continue;
            }
            survivingFlows.push(flow);
            this.traceGraph?.recordAuditGate({
                label: flow.source,
                toFact: flow.sinkFactId,
                stage: "reporting",
                producer: "reporting",
                gateKind: "report_emission",
                scope: `reporting:${flow.sinkFactId || flow.toString()}`,
                attempted: true,
                matched: true,
                emitted: true,
                evidence: {
                    sink: flow.sink.toString(),
                    judgement: flowResult.judgement.kind,
                },
            });
        }

        return { results, suppressed, survivingFlows };
    }

    private detectSinksByRulesCore(
        sinkRules: SinkRule[],
        options?: {
            stopOnFirstFlow?: boolean;
            maxFlowsPerEntry?: number;
            sanitizerRules?: SanitizerRule[];
        }
    ): TaintFlow[] {
        if (!sinkRules || sinkRules.length === 0) return [];
        const maxFlowLimit = options?.stopOnFirstFlow
            ? 1
            : options?.maxFlowsPerEntry;

        const flowMap = new Map<string, TaintFlow>();
        const detectCache = new Map<string, TaintFlow[]>();
        const cloneFlow = (flow: TaintFlow): TaintFlow => {
            return new TaintFlow(flow.source, flow.sink, {
                sourceRuleId: flow.sourceRuleId,
                sinkRuleId: flow.sinkRuleId,
                sinkEndpoint: flow.sinkEndpoint,
                sinkNodeId: flow.sinkNodeId,
                sinkFieldPath: flow.sinkFieldPath ? [...flow.sinkFieldPath] : undefined,
                transferRuleIds: flow.transferRuleIds ? [...flow.transferRuleIds] : undefined,
                sinkFactId: flow.sinkFactId,
                suppressionReason: flow.suppressionReason,
            });
        };
        const buildDetectCacheKey = (
            rule: SinkRule,
            target: {
                targetEndpoint?: RuleEndpoint;
                targetPath?: string[];
                targetTaintScope?: RuleEndpointTaintScope;
            },
        ): string => {
            const endpoint = target.targetEndpoint || "";
            const path = target.targetPath && target.targetPath.length > 0
                ? target.targetPath.join(".")
                : "";
            const taintScope = target.targetTaintScope || "";
            const identity = rule.apiEffect;
            return [
                identity?.canonicalApiId || "",
                identity?.assetId || "",
                identity?.surfaceId || "",
                identity?.bindingId || "",
                identity?.effectTemplateId || "",
                endpoint,
                path,
                taintScope,
            ].join("|");
        };
        const buildFlowDedupKey = (flow: TaintFlow): string => {
            const sinkMethodSig = flow.sink?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.() || "";
            const sinkEndpoint = flow.sinkEndpoint || "";
            const sinkNodeId = flow.sinkNodeId === undefined ? "" : String(flow.sinkNodeId);
            const sinkFieldPath = flow.sinkFieldPath && flow.sinkFieldPath.length > 0
                ? flow.sinkFieldPath.join(".")
                : "";
            return `${flow.source} -> ${sinkMethodSig} -> ${flow.sink.toString()} -> ${sinkEndpoint} -> ${sinkNodeId} -> ${sinkFieldPath}`;
        };
        const addFlows = (ruleId: string, flows: TaintFlow[]): void => {
            let added = 0;
            for (const f of flows) {
                if (maxFlowLimit !== undefined && flowMap.size >= maxFlowLimit) {
                    break;
                }
                const key = buildFlowDedupKey(f);
                if (!flowMap.has(key)) {
                    flowMap.set(key, f);
                    added++;
                }
            }
            if (added > 0) this.markRuleHit("sink", ruleId, added);
        };
        const reachedFlowLimit = (): boolean => {
            return maxFlowLimit !== undefined && flowMap.size >= maxFlowLimit;
        };

        const orderedSinkRules = this.orderRulesByFamily(sinkRules);
        const detectStartedAt = Date.now();
        this.progress(`[detect] sink rules start count=${orderedSinkRules.length}`);
        let processedSinkRules = 0;
        for (const rule of orderedSinkRules) {
            processedSinkRules++;
            if (processedSinkRules === 1 || processedSinkRules % 20 === 0) {
                this.progress(`[detect] sink rules progress processed=${processedSinkRules}/${orderedSinkRules.length} flows=${flowMap.size} elapsed_ms=${Date.now() - detectStartedAt}`);
            }
            if (reachedFlowLimit()) break;
            if (!hasApiEffectIdentity(rule)) continue;
            const target = this.resolveSinkRuleTarget(rule);
            const sinkEndpoint = target.targetEndpoint || "any_arg";
            const sinkPathSuffix = target.targetPath && target.targetPath.length > 0
                ? `.${target.targetPath.join(".")}`
                : "";
            const cacheKey = buildDetectCacheKey(rule, target);
            let flows: TaintFlow[];
            const cached = detectCache.get(cacheKey);
            if (cached) {
                flows = cached.map(cloneFlow);
            } else {
                const computed = this.detectSinkEffects(rule, {
                    ...target,
                    sinkRuleId: rule.id,
                    sanitizerRules: options?.sanitizerRules || [],
                    apiEffectRuntimeIndex: this.apiEffectRuntimeIndex,
                });
                detectCache.set(cacheKey, computed.map(cloneFlow));
                flows = computed.map(cloneFlow);
            }
            for (const flow of flows) {
                flow.sinkRuleId = rule.id;
                flow.sinkEndpoint = `${sinkEndpoint}${sinkPathSuffix}`;
                if (!flow.sourceRuleId) {
                    flow.sourceRuleId = this.parseSourceRuleId(flow.source);
                }
                if (flow.sinkNodeId !== undefined) {
                    const chains = this.getRuleChainsForNodeAnyContext(flow.sinkNodeId, flow.sinkFieldPath);
                    const transferSet = new Set<string>(flow.transferRuleIds || []);
                    for (const chain of chains) {
                        if (!flow.sourceRuleId && chain.sourceRuleId) {
                            flow.sourceRuleId = chain.sourceRuleId;
                        }
                        for (const rid of chain.transferRuleIds) {
                            transferSet.add(rid);
                        }
                    }
                    flow.transferRuleIds = [...transferSet].sort();
                    flow.sinkFactId = this.resolveBestSinkFactId(flow.sinkNodeId, flow.sinkFieldPath, flow.source, flow.sourceRuleId);
                }
            }
            addFlows(rule.id, flows);
        }
        this.progress(`[detect] sink rules done processed=${processedSinkRules}/${orderedSinkRules.length} flows=${flowMap.size} elapsed_ms=${Date.now() - detectStartedAt}`);

        return Array.from(flowMap.values());
    }

    private runWorkList(worklist: TaintFact[], visited: Set<string>): void {
        const startedAt = process.hrtime.bigint();
        this.progress(`[worklist] setup start initial=${worklist.length} visited=${visited.size}`);
        this.lastWorklistTruncation = undefined;
        this.prepareDebugCollectors();
        const orderedTransferRules = this.orderRulesByFamily([
            ...this.normalizeRuntimeTransferRules(this.options.transferRules || [], "runtime_project"),
        ]);
        this.progress(`[worklist] transfer rules ready count=${orderedTransferRules.length}`);
        const propagationHooks = this.enginePluginRuntime.beginPropagation({
            pag: this.pag,
        });
        this.progress("[worklist] propagation hooks ready");
        const deps = this.buildWorklistSolverDeps(orderedTransferRules, propagationHooks);
        this.progress("[worklist] solver start");
        runWorklistSolvingStage({
            worklist,
            visited,
            deps,
            hooks: propagationHooks,
            solve: (stageWorklist, stageVisited, stageDeps) => {
                const solver = new WorklistSolver(stageDeps);
                solver.solve(stageWorklist, stageVisited);
                return {
                    visitedCount: stageVisited.size,
                };
            },
        });
        this.progress(`[worklist] solver done elapsed_ms=${Math.round(this.elapsedMsSince(startedAt))} visited=${visited.size}`);
    }

    private buildWorklistSolverDeps(
        orderedTransferRules: TransferRule[],
        propagationHooks: ActivePropagationHooks,
    ): WorklistSolverDeps {
        const moduleQueries: InternalModuleQueryApi = {
            resolveMethodsFromCallable,
            collectParameterAssignStmts,
            collectFiniteStringCandidatesFromValue,
        };
        this.refreshModuleRuntime();
        const moduleRuntime = this.moduleRuntime || createModuleRuntime(this.modules, {
            scene: this.scene,
            pag: this.pag,
            allowedMethodSignatures: this.activeReachableMethodSignatures,
            fieldToVarIndex: this.fieldToVarIndex,
            queries: moduleQueries,
            log: this.log.bind(this),
            moduleSetupDeadlineMs: this.options.debug?.moduleSetupMaxElapsedMs,
            currentnessAnalysis: this.options.currentness || "enabled",
            canonicalApiOccurrences: this.buildModuleCanonicalApiOccurrences(),
            canonicalDecoratorOccurrences: this.buildModuleCanonicalDecoratorOccurrences(),
        });
        this.moduleRuntime = moduleRuntime;
        const recordProvenance = this.options.provenanceRecording !== "disabled";
        const trackFlowRuleChains = this.options.flowRuleChainTracking !== "disabled";
        return {
            scene: this.scene,
            pag: this.pag,
            tracker: this.tracker,
            ctxManager: this.ctxManager,
            callEdgeMap: this.callEdgeMap,
            receiverFieldBridgeMap: this.receiverFieldBridgeMap,
            captureEdgeMap: this.captureEdgeMap,
            syntheticInvokeEdgeMap: this.syntheticInvokeEdgeMap,
            syntheticConstructorStoreMap: this.syntheticConstructorStoreMap,
            syntheticStaticInitStoreMap: this.syntheticStaticInitStoreMap,
            syntheticFieldBridgeMap: this.syntheticFieldBridgeMap,
            ensureCaptureEdgesForNode: (nodeId) => this.ensureLazyCaptureEdgesForNode(nodeId),
            ensureSyntheticInvokeEdgesForNode: (nodeId) => this.ensureLazySyntheticInvokeEdgesForNode(nodeId),
            fieldToVarIndex: this.fieldToVarIndex,
            transferRules: orderedTransferRules,
            apiEffectRuntimeIndex: this.apiEffectRuntimeIndex,
            onTransferRuleHit: (event) => this.markRuleHit("transfer", event.ruleId, 1),
            getInitialRuleChainForFact: (fact) => this.initialFlowRuleChainForFact(fact),
            onFactRuleChain: trackFlowRuleChains
                ? (factId, chain) => this.upsertFactRuleChain(factId, chain)
                : undefined,
            profiler: this.worklistProfiler,
            traceGraph: this.traceGraph,
            allowedMethodSignatures: this.activeReachableMethodSignatures,
            moduleRuntime,
            moduleQueries,
            onFactObserved: recordProvenance ? (fact) => this.recordObservedFact(fact) : undefined,
            onFactPredecessor: recordProvenance ? (record) => this.recordFactPredecessor(record) : undefined,
            onCallEdge: (event) => propagationHooks.onCallEdge(event),
            onTaintFlow: (event) => propagationHooks.onTaintFlow(event),
            onMethodReached: (event) => propagationHooks.onMethodReached(event),
            budget: this.buildWorklistBudget(),
            log: this.log.bind(this),
            progress: this.progress.bind(this),
        };
    }

    private buildWorklistBudget(): WorklistSolverDeps["budget"] | undefined {
        const maxDequeues = this.options.debug?.worklistMaxDequeues;
        const maxVisited = this.options.debug?.worklistMaxVisited;
        const maxElapsedMs = this.options.debug?.worklistMaxElapsedMs;
        if (!maxDequeues && !maxVisited && !maxElapsedMs) {
            return undefined;
        }
        this.log(`[WorklistBudget] enabled maxDequeues=${maxDequeues || 0} maxVisited=${maxVisited || 0} maxElapsedMs=${maxElapsedMs || 0}`);
        return {
            maxDequeues,
            maxVisited,
            maxElapsedMs,
            onTruncated: (event) => {
                this.lastWorklistTruncation = event;
            },
        };
    }

    private recordObservedFact(fact: TaintFact): void {
        this.observedFacts.set(fact.taintId, fact);
    }

    private recordFactPredecessor(record: FactPredecessorRecord): void {
        if (!record.toFactId || !record.fromFactId) return;
        const edgeKey = `${record.toFactId}|${record.fromFactId}|${record.reason || ""}`;
        if (this.factPredecessorEdgeKeys.has(edgeKey)) return;
        this.factPredecessorEdgeKeys.add(edgeKey);
        const currentnessEvidenceIds = [
            ...(record.currentnessCertificateIds || []).map(id => `evidence|${id}`),
        ];
        for (const certificate of record.currentnessCertificates || []) {
            const evidence = currentnessEvidenceFromCertificate(certificate);
            this.currentnessEvidenceById.set(evidence.id, evidence);
            if (!currentnessEvidenceIds.includes(evidence.id)) {
                currentnessEvidenceIds.push(evidence.id);
            }
        }
        const normalizedRecord: FactPredecessorRecord = {
            ...record,
            currentnessCertificateIds: currentnessEvidenceIds.length > 0 ? currentnessEvidenceIds : undefined,
            currentnessCertificates: undefined,
        };
        const bucket = this.factPredecessorsByFactId.get(record.toFactId) || [];
        if (!this.factPredecessorsByFactId.has(record.toFactId)) {
            this.factPredecessorsByFactId.set(record.toFactId, bucket);
        }
        bucket.push(normalizedRecord);
    }

    private buildPostsolveContext(options?: { sanitizerRules?: SanitizerRule[]; materialize?: PathMaterializationOptions }): PostsolveContext {
        return {
            pag: this.pag,
            observedFactsById: this.observedFacts,
            factPredecessorsByFactId: this.factPredecessorsByFactId,
            currentnessEvidenceById: this.currentnessEvidenceById,
            sanitizerRules: options?.sanitizerRules || [],
            materializationOptions: options?.materialize,
        };
    }

    public getObservedTaintFacts(): ReadonlyMap<number, readonly TaintFact[]> {
        const byNode = new Map<number, TaintFact[]>();
        for (const fact of this.observedFacts.values()) {
            const nodeId = fact.node.getID();
            if (!byNode.has(nodeId)) {
                byNode.set(nodeId, []);
            }
            byNode.get(nodeId)!.push(fact);
        }
        return byNode;
    }

    private buildEnginePluginDetectionContext(sanitizerRules: SanitizerRule[]) {
        return {
            scene: this.scene,
            pag: this.pag,
            cg: this.cg,
            tracker: this.tracker,
            getTaintFacts: () => this.getObservedTaintFacts(),
        };
    }

    public finishEnginePlugins(extra: {
        sourceDir?: string;
        elapsedMs?: number;
        reachableMethodCount?: number;
    } = {}): void {
        this.enginePluginRuntime.finish({
            sourceDir: extra.sourceDir,
            elapsedMs: extra.elapsedMs,
            reachableMethodCount: extra.reachableMethodCount,
            findingCount: this.lastEnginePluginFindings.length,
            taintedFactCount: this.observedFacts.size,
            loadedModuleIds: this.modules.map(module => module.id),
            loadedPluginNames: this.enginePluginRuntime.listPluginNames(),
        }, this.lastEnginePluginFindings);
    }

    private ensureLazyCaptureEdgesForNode(nodeId: number): CaptureEdgeInfo[] | undefined {
        const cacheEntry = this.activePagCacheEntry;
        if (!cacheEntry) {
            return this.captureEdgeMap.get(nodeId);
        }
        if (cacheEntry.captureLazyMaterializer) {
            materializeCaptureSitesForNode(this.pag, this.captureEdgeMap, cacheEntry.captureLazyMaterializer, nodeId);
            return this.captureEdgeMap.get(nodeId);
        }
        if (!cacheEntry.captureEdgeMapReady) {
            this.log("[LazyEdges] materializing captureEdgeMap on first demand");
            cacheEntry.captureEdgeMap = buildCaptureEdgeMap(this.scene, this.cg, this.pag, this.log.bind(this));
            cacheEntry.captureEdgeMapReady = true;
            this.captureEdgeMap = cacheEntry.captureEdgeMap;
        }
        return this.captureEdgeMap.get(nodeId);
    }

    private ensureLazySyntheticInvokeEdgesForNode(nodeId: number): SyntheticInvokeEdgeInfo[] | undefined {
        const cacheEntry = this.activePagCacheEntry;
        const forcedDirectCallerSignatures = this.getDeferredUnitSignatures();
        if (!cacheEntry) {
            return this.syntheticInvokeEdgeMap.get(nodeId);
        }
        if (cacheEntry.syntheticInvokeLazyMaterializer) {
            materializeEagerSyntheticInvokeSites(
                this.scene,
                this.cg,
                this.pag,
                this.syntheticInvokeEdgeMap,
                cacheEntry.syntheticInvokeLazyMaterializer,
                cacheEntry.executionHandoffDeferredSiteKeys,
                forcedDirectCallerSignatures,
            );
            materializeSyntheticInvokeSitesForNode(
                this.scene,
                this.cg,
                this.pag,
                this.syntheticInvokeEdgeMap,
                cacheEntry.syntheticInvokeLazyMaterializer,
                nodeId,
                cacheEntry.executionHandoffDeferredSiteKeys,
                forcedDirectCallerSignatures,
            );
            return this.syntheticInvokeEdgeMap.get(nodeId);
        }
        if (!cacheEntry.syntheticInvokeEdgeMapReady) {
            this.log("[LazyEdges] materializing syntheticInvokeEdgeMap on first demand");
            cacheEntry.syntheticInvokeEdgeMap = buildSyntheticInvokeEdges(
                this.scene,
                this.cg,
                this.pag,
                this.log.bind(this),
                cacheEntry.executionHandoffDeferredSiteKeys,
                forcedDirectCallerSignatures,
                this.callEdgeMaterializationLedger,
            );
            cacheEntry.syntheticInvokeEdgeMapReady = true;
            this.syntheticInvokeEdgeMap = cacheEntry.syntheticInvokeEdgeMap;
        }
        return this.syntheticInvokeEdgeMap.get(nodeId);
    }

    private ensureAllSyntheticInvokeEdgesMaterialized(budget?: BuildStageBudget): void {
        const cacheEntry = this.activePagCacheEntry;
        const forcedDirectCallerSignatures = this.getDeferredUnitSignatures();
        if (!cacheEntry) return;
        if (cacheEntry.syntheticInvokeLazyMaterializer) {
            materializeAllSyntheticInvokeSites(
                this.scene,
                this.cg,
                this.pag,
                this.syntheticInvokeEdgeMap,
                cacheEntry.syntheticInvokeLazyMaterializer,
                cacheEntry.executionHandoffDeferredSiteKeys,
                forcedDirectCallerSignatures,
                budget,
            );
            return;
        }
        if (!cacheEntry.syntheticInvokeEdgeMapReady) {
            cacheEntry.syntheticInvokeEdgeMap = buildSyntheticInvokeEdges(
                this.scene,
                this.cg,
                this.pag,
                this.log.bind(this),
                cacheEntry.executionHandoffDeferredSiteKeys,
                forcedDirectCallerSignatures,
                this.callEdgeMaterializationLedger,
            );
            cacheEntry.syntheticInvokeEdgeMapReady = true;
            this.syntheticInvokeEdgeMap = cacheEntry.syntheticInvokeEdgeMap;
        }
    }

    private getDeferredUnitSignatures(): Set<string> {
        const out = new Set<string>();
        for (const contract of this.executionHandoffSnapshot?.contracts || []) {
            if (contract?.unitSignature) {
                out.add(contract.unitSignature);
            }
        }
        return out;
    }

    private collectSourceRuleSeeds(
        sourceRules: SourceRule[],
        allowedMethodSignatures?: Set<string>
    ): {
        facts: TaintFact[];
        seededLocals: string[];
        sourceRuleHits: Record<string, number>;
        activatedMethodSignatures: string[];
        sourceSeedAudit: SourceRuleSeedAuditEntry[];
        sourceRuleZeroHitAudit: SourceRuleZeroHitAuditEntry[];
        endpointResolutionAudit: EndpointResolutionLedgerItem[];
    } {
        return collectSourceRuleSeedsFromRules({
            scene: this.scene,
            pag: this.pag,
            sourceRules: this.orderRulesByFamily(sourceRules || []),
            emptyContextId: this.ctxManager.getEmptyContextID(),
            allowedMethodSignatures,
            apiEffectRuntimeIndex: this.apiEffectRuntimeIndex,
        });
    }

    private collectSourceRuleSeedsToFixedPoint(
        sourceRules: SourceRule[],
        initialAllowedMethodSignatures?: Set<string>
    ): SourceRuleSeedCollectionAggregate {
        const facts: TaintFact[] = [];
        const seenFactIds = new Set<string>();
        const seededLocals = new Set<string>();
        const sourceRuleHits = new Map<string, number>();
        const activatedMethodSignatures = new Set<string>();
        const scannedMethodSignatures = new Set<string>();
        const sourceSeedAudit: SourceRuleSeedAuditEntry[] = [];
        const seenSourceSeedAuditFactIds = new Set<string>();
        const sourceRuleZeroHitAuditByRuleId = new Map<string, SourceRuleZeroHitAuditEntry>();
        const endpointResolutionAudit: EndpointResolutionLedgerItem[] = [];

        let nextAllowed = initialAllowedMethodSignatures
            ? new Set(initialAllowedMethodSignatures)
            : undefined;
        let passCount = 0;
        const maxPasses = 4;
        this.progress(
            `[source-seed] fixed point start max_passes=${maxPasses} `
            + `initial_allowed=${initialAllowedMethodSignatures?.size ?? 0} `
            + `direct_expansion=${this.options.reachabilityDirectExpansion !== "disabled" ? "enabled" : "disabled"}`,
        );
        const syntheticSeedMaterializeT0 = process.hrtime.bigint();
        this.progress("[source-seed] synthetic invoke materialization start");
        this.ensureAllSyntheticInvokeEdgesMaterialized();
        this.progress(`[source-seed] synthetic invoke materialization done elapsed_ms=${Math.round(this.elapsedMsSince(syntheticSeedMaterializeT0))}`);
        let exactReachabilityAdjacency: Map<string, Set<string>> | undefined;
        const getExactReachabilityAdjacency = (): Map<string, Set<string>> => {
            if (exactReachabilityAdjacency) return exactReachabilityAdjacency;
            const exactAdjacencyT0 = process.hrtime.bigint();
            this.progress("[source-seed] exact reachability adjacency start");
            exactReachabilityAdjacency = this.buildExactMethodReachabilityAdjacency();
            this.progress(
                `[source-seed] exact reachability adjacency done callers=${exactReachabilityAdjacency.size} `
                + `elapsed_ms=${Math.round(this.elapsedMsSince(exactAdjacencyT0))}`,
            );
            return exactReachabilityAdjacency;
        };

        for (let pass = 0; pass < maxPasses; pass += 1) {
            if (nextAllowed && nextAllowed.size === 0) break;
            passCount += 1;
            const passAllowed = nextAllowed ? new Set(nextAllowed) : undefined;
            this.progress(
                `[source-seed] pass ${passCount} start allowed=${passAllowed?.size ?? "all"} `
                + `scanned=${scannedMethodSignatures.size}`,
            );
            if (passAllowed) {
                for (const sig of passAllowed) {
                    scannedMethodSignatures.add(sig);
                }
            }

            const passSeeds = this.collectSourceRuleSeeds(sourceRules, passAllowed);
            endpointResolutionAudit.push(...passSeeds.endpointResolutionAudit);
            for (const audit of passSeeds.sourceRuleZeroHitAudit || []) {
                if (!sourceRuleZeroHitAuditByRuleId.has(audit.ruleId)) {
                    sourceRuleZeroHitAuditByRuleId.set(audit.ruleId, audit);
                }
            }
            for (const fact of passSeeds.facts) {
                if (seenFactIds.has(fact.taintId)) continue;
                seenFactIds.add(fact.taintId);
                facts.push(fact);
                const ruleId = this.parseSourceRuleId(fact.source);
                if (ruleId) {
                    sourceRuleHits.set(ruleId, (sourceRuleHits.get(ruleId) || 0) + 1);
                    sourceRuleZeroHitAuditByRuleId.delete(ruleId);
                }
            }
            for (const audit of passSeeds.sourceSeedAudit) {
                if (seenSourceSeedAuditFactIds.has(audit.factId)) continue;
                if (!facts.some(fact => fact.taintId === audit.factId)) continue;
                seenSourceSeedAuditFactIds.add(audit.factId);
                sourceSeedAudit.push({ ...audit, fieldPath: audit.fieldPath ? [...audit.fieldPath] : undefined });
            }
            for (const label of passSeeds.seededLocals) {
                seededLocals.add(label);
            }

            const pending = new Set<string>();
            for (const sig of passSeeds.activatedMethodSignatures) {
                if (!sig) continue;
                activatedMethodSignatures.add(sig);
                if (!scannedMethodSignatures.has(sig)) {
                    pending.add(sig);
                }
            }
            if (pending.size === 0) {
                this.progress("[source-seed] exact reachability adjacency skipped no_new_activated_methods");
            }
            const expandedPending = pending.size === 0
                ? new Set<string>()
                : this.expandPendingMethodSignaturesByExactReachability(
                    pending,
                    scannedMethodSignatures,
                    getExactReachabilityAdjacency(),
                );
            this.progress(
                `[source-seed] pass ${passCount} done seeds_total=${facts.length} `
                + `new_activated=${pending.size} next_allowed=${expandedPending.size}`,
            );

            if (!initialAllowedMethodSignatures) {
                break;
            }
            nextAllowed = expandedPending;
        }

        const finalSourceRuleZeroHitAudit = [...sourceRuleZeroHitAuditByRuleId.values()]
            .filter(audit => (sourceRuleHits.get(audit.ruleId) || 0) === 0)
            .sort((a, b) => a.ruleId.localeCompare(b.ruleId));

        return {
            facts,
            seededLocals: [...seededLocals].sort(),
            sourceRuleHits: Object.fromEntries([...sourceRuleHits.entries()].sort(([a], [b]) => a.localeCompare(b))),
            activatedMethodSignatures: [...activatedMethodSignatures].sort(),
            sourceSeedAudit,
            sourceRuleZeroHitAudit: finalSourceRuleZeroHitAudit,
            passCount,
            endpointResolutionAudit,
        };
    }

    private buildExactMethodReachabilityAdjacency(): Map<string, Set<string>> {
        this.progress("[source-seed] exact adjacency base graph start");
        const adjacency = new Map<string, Set<string>>();
        const deferredUnitSignatures = this.getDeferredUnitSignatures();
        const addEdge = (callerSignature?: string, calleeSignature?: string): void => {
            if (!callerSignature || !calleeSignature) return;
            if (deferredUnitSignatures.has(calleeSignature)) return;
            let callees = adjacency.get(callerSignature);
            if (!callees) {
                callees = new Set<string>();
                adjacency.set(callerSignature, callees);
            }
            callees.add(calleeSignature);
        };

        const nodesIter = this.cg?.getNodesIter?.();
        if (nodesIter) {
            for (const node of nodesIter) {
                const callerSignature = safeValueText(this.cg?.getMethodByFuncID?.(node.getID?.()));
                if (!callerSignature) continue;
                for (const edge of node.getOutgoingEdges?.() || []) {
                    const calleeSignature = safeValueText(this.cg?.getMethodByFuncID?.(edge.getDstID?.()));
                    addEdge(callerSignature, calleeSignature);
                }
            }
        }

        for (const edges of this.syntheticInvokeEdgeMap.values()) {
            for (const edge of edges) {
                if (edge.type !== CallEdgeType.CALL) continue;
                addEdge(edge.callerSignature, edge.calleeSignature);
            }
        }
        this.progress(`[source-seed] exact adjacency base graph done callers=${adjacency.size}`);

        if (this.options.reachabilityDirectExpansion !== "disabled") {
            const directAdjacencyT0 = process.hrtime.bigint();
            this.progress("[source-seed] exact adjacency contextual direct expansion start");
            const candidateSignatures = new Set<string>();
            for (const [callerSignature, calleeSignatures] of adjacency.entries()) {
                candidateSignatures.add(callerSignature);
                for (const calleeSignature of calleeSignatures) {
                    candidateSignatures.add(calleeSignature);
                }
            }
            const methodsBySignature = this.getMethodsBySignature();
            const thisOwnerSeedMethods = [...candidateSignatures]
                .map(signature => methodsBySignature.get(signature))
                .filter((method): method is ArkMethod => !!method);
            const reusedThisOwnerContextIndex = this.syntheticInvokeLazyMaterializer?.lookupContext.thisOwnerNamesByMethodSignature;
            if (!reusedThisOwnerContextIndex) {
                this.progress(`[source-seed] this owner context index build start seeds=${thisOwnerSeedMethods.length}`);
            }
            const thisOwnerContextIndex = reusedThisOwnerContextIndex
                || buildMethodThisOwnerContextIndex(this.scene, thisOwnerSeedMethods, {
                    log: msg => this.progress(`[source-seed] ${msg}`),
                    progressInterval: 200,
                });
            this.progress(
                `[source-seed] exact adjacency contextual direct expansion candidates=${candidateSignatures.size} `
                + `methods=${methodsBySignature.size}`,
            );
            let processed = 0;
            for (const signature of candidateSignatures) {
                processed++;
                if (processed === 1 || processed % 50 === 0) {
                    this.progress(
                        `[source-seed] exact adjacency contextual direct expansion processing #${processed} `
                        + `current=${this.shortReachableSignature(signature)}`,
                    );
                }
                const method = methodsBySignature.get(signature);
                if (!method) continue;
                for (const targetSignature of this.collectContextualDirectCallExpansionTargetSignatures(method, thisOwnerContextIndex)) {
                    addEdge(signature, targetSignature);
                }
            }
            this.progress(
                `[source-seed] exact adjacency contextual direct expansion done processed=${processed} `
                + `elapsed_ms=${Math.round(this.elapsedMsSince(directAdjacencyT0))}`,
            );
        }

        return adjacency;
    }

    private expandPendingMethodSignaturesByExactReachability(
        seedSignatures: Set<string>,
        scannedMethodSignatures: Set<string>,
        adjacency: Map<string, Set<string>>,
    ): Set<string> {
        const pending = new Set<string>();
        const queued = new Set<string>();
        const queue: string[] = [];
        const enqueue = (signature?: string): void => {
            if (!signature || queued.has(signature)) return;
            queued.add(signature);
            queue.push(signature);
            if (!scannedMethodSignatures.has(signature)) {
                pending.add(signature);
            }
        };
        for (const signature of seedSignatures) {
            enqueue(signature);
        }
        for (let head = 0; head < queue.length; head += 1) {
            const signature = queue[head];
            const callees = adjacency.get(signature);
            if (!callees) continue;
            for (const callee of callees) {
                enqueue(callee);
            }
        }
        return pending;
    }

    private mergeAutoEntrySourceRules(sourceRules: SourceRule[]): SourceRule[] {
        if (this.autoEntrySourceRules.length === 0 && this.autoAmbientSourceRules.length === 0) {
            return sourceRules;
        }
        const disabledAutoSourcePrefixes = this.options.disabledAutoSourceRuleIdPrefixes || [];
        const filteredAutoSourceRules = [...this.autoEntrySourceRules, ...this.autoAmbientSourceRules].filter(rule => {
            const ruleId = rule?.id || "";
            return !disabledAutoSourcePrefixes.some(prefix => prefix && ruleId.startsWith(prefix));
        });
        const baseRules = sourceRules || [];
        const merged = new Map<string, SourceRule>();
        for (const rule of [...baseRules, ...filteredAutoSourceRules]) {
            if (!rule?.id) continue;
            if (!merged.has(rule.id)) {
                merged.set(rule.id, rule);
            }
        }
        return [...merged.values()];
    }

    private normalizeRuntimeSourceRules(
        sourceRules: SourceRule[],
        origin: "runtime_project" | "plugin_runtime",
    ): SourceRule[] {
        return (sourceRules || []).map(rule => normalizeRuleFamily(rule, { kind: origin }, "source"));
    }

    private normalizeRuntimeSinkRules(
        sinkRules: SinkRule[],
        origin: "runtime_project" | "plugin_runtime",
    ): SinkRule[] {
        return (sinkRules || []).map(rule => normalizeRuleFamily(rule, { kind: origin }, "sink"));
    }

    private normalizeRuntimeSanitizerRules(
        sanitizerRules: SanitizerRule[],
        origin: "runtime_project" | "plugin_runtime",
    ): SanitizerRule[] {
        return (sanitizerRules || []).map(rule => normalizeRuleFamily(rule, { kind: origin }, "sanitizer"));
    }

    private normalizeRuntimeTransferRules(
        transferRules: TransferRule[],
        origin: "runtime_project" | "plugin_runtime",
    ): TransferRule[] {
        return (transferRules || []).map(rule => normalizeRuleFamily(rule, { kind: origin }, "transfer"));
    }

    private recoverMethodSignaturesFromSeedFacts(facts: TaintFact[]): Set<string> {
        const recovered = new Set<string>();
        const recoveredClassNames = new Set<string>();
        const recoveredFilePaths = new Set<string>();
        for (const fact of facts) {
            const nodeValue: any = fact.node?.getValue?.();
            const declaringStmt: any = nodeValue?.getDeclaringStmt?.();
            const cfg = declaringStmt?.getCfg?.();
            const declaringMethod = cfg?.getDeclaringMethod?.();
            const methodSig = safeMethodSignatureText(declaringMethod);
            if (methodSig) {
                recovered.add(methodSig);
            }
            const clsName = declaringMethod?.getDeclaringArkClass?.()?.getName?.();
            if (clsName) {
                recoveredClassNames.add(clsName);
            }
            const methodSigText = safeMethodSignatureText(declaringMethod);
            const filePath = extractFilePathFromSignature(methodSigText);
            if (filePath) {
                recoveredFilePaths.add(filePath);
            }
        }
        if (recoveredClassNames.size > 0) {
            for (const method of this.scene.getMethods()) {
                const clsName = method.getDeclaringArkClass?.()?.getName?.();
                if (!clsName || !recoveredClassNames.has(clsName)) continue;
                const sig = safeMethodSignatureText(method);
                if (sig) {
                    recovered.add(sig);
                }
            }
        }
        if (recoveredFilePaths.size > 0) {
            for (const method of this.scene.getMethods()) {
                const sig = safeMethodSignatureText(method);
                const filePath = extractFilePathFromSignature(sig);
                if (!filePath || !recoveredFilePaths.has(filePath)) continue;
                if (sig) recovered.add(sig);
            }
        }
        return recovered;
    }

    private buildAutoEntrySourceRules(
        arkMainPlan?: ReturnType<typeof buildArkMainPlan>,
    ): SourceRule[] {
        void arkMainPlan;
        return [];
    }

    private buildAmbientFrameworkSourceRules(
        arkMainPlan?: ReturnType<typeof buildArkMainPlan>,
    ): SourceRule[] {
        void arkMainPlan;
        return [];
    }

    private detectSinkEffects(
        sinkRule: SinkRule,
        options?: {
            targetEndpoint?: RuleEndpoint;
            targetPath?: string[];
            sanitizerRules?: SanitizerRule[];
            sinkRuleId?: string;
            apiEffectRuntimeIndex?: ApiEffectRuntimeIndex;
        }
    ): TaintFlow[] {
        if (!this.cg) return [];
        if (!hasApiEffectIdentity(sinkRule)) return [];
        const orderedTransferRules = this.orderRulesByFamily([
            ...this.normalizeRuntimeTransferRules(this.options.transferRules || [], "runtime_project"),
        ]);
        const effectLabel = [
            sinkRule.apiEffect.canonicalApiId,
            sinkRule.apiEffect.assetId,
            sinkRule.apiEffect.surfaceId,
            sinkRule.apiEffect.bindingId,
            sinkRule.apiEffect.effectTemplateId,
        ].join("|");
        const allowedMethodSignatures = this.options.semanticAssetReachabilityScope === "allExactSites"
            && this.isEvaluationSemanticAssetRule(sinkRule)
            ? undefined
            : this.activeReachableMethodSignatures;
        const scoped = runSinkDetector(
            this.scene,
            this.cg,
            this.pag,
            this.tracker,
            effectLabel,
            this.log.bind(this),
            {
                ...options,
                fieldToVarIndex: this.fieldToVarIndex,
                allowedMethodSignatures,
                orderedMethodSignatures: this.activeOrderedMethodSignatures,
                interproceduralTaintTargetNodeIds: this.collectInterproceduralTaintTargetNodeIds(),
                transferRules: orderedTransferRules,
                apiIdentityRule: sinkRule,
                apiEffectRuntimeIndex: this.apiEffectRuntimeIndex,
                classBySignature: this.getClassSignatureIndex(),
                onProfile: (profile) => this.mergeDetectProfile(profile),
                onAudit: (entry) => this.recordSinkDetectionAudit(entry),
            }
        );
        return scoped;
    }

    private isEvaluationSemanticAssetRule(rule: { apiEffect?: { assetId?: string } } | undefined): boolean {
        const assetId = typeof rule?.apiEffect?.assetId === "string" ? rule.apiEffect.assetId : "";
        return assetId.startsWith("project.");
    }

    private collectInterproceduralTaintTargetNodeIds(): Set<number> {
        if (this.interproceduralTaintTargetNodeIdsCache) {
            return this.interproceduralTaintTargetNodeIdsCache;
        }
        const out = new Set<number>();
        for (const edges of this.captureEdgeMap.values()) {
            for (const edge of edges) {
                out.add(edge.dstNodeId);
            }
        }
        for (const edges of this.syntheticInvokeEdgeMap.values()) {
            for (const edge of edges) {
                out.add(edge.dstNodeId);
            }
        }
        if (this.pag) {
            const ordinarySharedStateIndex = buildOrdinarySharedStateIndex(this.scene, this.pag);
            for (const consumerNodeIds of ordinarySharedStateIndex.moduleImportBindingConsumerNodeIdsByKey.values()) {
                for (const nodeId of consumerNodeIds) {
                    out.add(nodeId);
                }
            }
            for (const consumerNodeIds of ordinarySharedStateIndex.moduleStateConsumerNodeIdsByKey.values()) {
                for (const nodeId of consumerNodeIds) {
                    out.add(nodeId);
                }
            }
        }
        this.interproceduralTaintTargetNodeIdsCache = out;
        return out;
    }

    private resolveSinkFlowCalleeSignature(flow: TaintFlow): string | undefined {
        const sinkStmt: any = flow.sink;
        if (!sinkStmt?.containsInvokeExpr?.()) {
            return undefined;
        }
        const invokeExpr: any = sinkStmt.getInvokeExpr?.();
        const signature = invokeExpr?.getMethodSignature?.()?.toString?.();
        if (typeof signature === "string" && signature.trim().length > 0) {
            return signature.trim();
        }
        const methodName = invokeExpr?.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.();
        if (typeof methodName === "string" && methodName.trim().length > 0) {
            return `.${methodName.trim()}(`;
        }
        return undefined;
    }

    private resolveSinkRuleTarget(rule: SinkRule): {
            targetEndpoint?: RuleEndpoint;
            targetPath?: string[];
            targetTaintScope?: RuleEndpointTaintScope;
    } {
        const norm = rule.target ? normalizeEndpoint(rule.target) : undefined;
        return {
            targetEndpoint: norm?.endpoint,
            targetPath: norm?.path,
            targetTaintScope: norm?.taintScope,
        };
    }

    private getClassSignatureIndex(): Map<string, any> {
        if (!this.classBySignatureCache) {
            this.classBySignatureCache = buildClassSignatureIndex(this.scene);
        }
        return this.classBySignatureCache;
    }

    public getAdaptiveContextSelector(): AdaptiveContextSelector | undefined {
        return this.adaptiveContextSelector;
    }

    public getWorklistProfile(): WorklistProfileSnapshot | undefined {
        if (!this.worklistProfiler) return undefined;
        return this.worklistProfiler.snapshot();
    }

    public getWorklistTruncation(): WorklistBudgetTruncation | undefined {
        return this.lastWorklistTruncation
            ? { ...this.lastWorklistTruncation }
            : undefined;
    }

    public getTraceGraphSnapshot(overrides: Partial<TraceGraph["run"]> = {}): TraceGraph | undefined {
        if (!this.traceGraph) return undefined;
        this.recordModuleAuditTraceGates();
        return this.traceGraph.snapshot(overrides);
    }

    public dumpDebugArtifacts(tag: string, outputDir: string = "tmp"): { profilePath?: string; traceGraphJsonPath?: string; traceGraphMarkdownPath?: string } {
        const safeTag = tag.replace(/[^A-Za-z0-9_.-]/g, "_");
        const profile = this.getWorklistProfile();
        const traceGraph = this.getTraceGraphSnapshot({ runId: `debug-${safeTag}` });
        return dumpDebugArtifactsToDir({ tag: safeTag, outputDir, profile, traceGraph });
    }

    private configureContextStrategy(): void {
        if (this.options.contextStrategy !== "adaptive") {
            this.adaptiveContextSelector = undefined;
            this.ctxManager.setContextKSelector(undefined);
            return;
        }

        this.adaptiveContextSelector = new AdaptiveContextSelector(
            this.scene,
            this.cg,
            this.options.adaptiveContext ?? {}
        );
        this.ctxManager.setContextKSelector((callerMethodName, calleeMethodName, defaultK) => {
            return this.adaptiveContextSelector!.selectK(callerMethodName, calleeMethodName, defaultK);
        });

        this.log(`[AdaptiveContext] enabled: ${this.adaptiveContextSelector.getSummary()}`);
        const hotspots = this.adaptiveContextSelector.getTopHotspots(5);
        if (hotspots.length > 0) {
            const text = hotspots.map(h => `${h.methodName}(fanIn=${h.fanIn},k=${h.selectedK})`).join(", ");
            this.log(`[AdaptiveContext] top hotspots: ${text}`);
        }
    }

    private prepareDebugCollectors(): void {
        const collectors = createDebugCollectors(this.options.debug);
        this.worklistProfiler = collectors.worklistProfiler;
        this.traceGraph = collectors.traceGraph;
    }

    private resolveExplicitEntryScope(seedMethods: ArkMethod[]): Set<string> | undefined {
        if (seedMethods.length === 0) return undefined;
        const expandedMethods = expandEntryMethodsByDirectCalls(this.scene, seedMethods);
        const signatures = new Set<string>();
        for (const method of expandedMethods) {
            const signature = safeMethodSignatureText(method);
            if (!signature) continue;
            signatures.add(signature);
        }
        return signatures.size > 0 ? signatures : undefined;
    }

    private getMethodsBySignature(): Map<string, ArkMethod> {
        if (this.methodsBySignatureCache) return this.methodsBySignatureCache;
        const methodsBySig = new Map<string, ArkMethod>();
        for (const method of this.scene.getMethods()) {
            const signature = safeMethodSignatureText(method);
            if (signature) methodsBySig.set(signature, method);
        }
        this.methodsBySignatureCache = methodsBySig;
        return methodsBySig;
    }

    private collectPagMethodScope(): ArkMethod[] {
        if (!this.pag) return [];
        const methodsBySig = this.getMethodsBySignature();
        const signatures = new Set<string>();
        const nodesIter = this.pag.getNodesIter?.();
        if (!nodesIter) return [];
        for (const rawNode of nodesIter) {
            const node = rawNode as PagNode;
            const stmtMethodSig = node.getStmt?.()?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.();
            if (stmtMethodSig) {
                signatures.add(stmtMethodSig);
                continue;
            }
            const valueMethodSig = (node.getValue?.() as any)
                ?.getDeclaringStmt?.()
                ?.getCfg?.()
                ?.getDeclaringMethod?.()
                ?.getSignature?.()
                ?.toString?.();
            if (valueMethodSig) signatures.add(valueMethodSig);
        }
        return [...signatures]
            .map(signature => methodsBySig.get(signature))
            .filter((method): method is ArkMethod => !!method);
    }

    private getPagBuildCacheForScene(): Map<string, PagBuildCacheEntry> {
        let cache = TaintPropagationEngine.pagBuildCacheByScene.get(this.scene);
        if (!cache) {
            cache = new Map<string, PagBuildCacheEntry>();
            TaintPropagationEngine.pagBuildCacheByScene.set(this.scene, cache);
        }
        return cache;
    }

    private buildModulePlanCacheKey(): string {
        if (!this.modules || this.modules.length === 0) {
            return "none";
        }
        return this.modules
            .map(module => {
                const setupText = typeof module.setup === "function"
                    ? module.setup.toString()
                    : "";
                return `${module.id}|${module.description}|${setupText}`;
            })
            .sort((left, right) => left.localeCompare(right))
            .join("||");
    }

}

function mergeSourceRuleSeedCollectionResults(
    left: SourceRuleSeedCollectionAggregate,
    right: SourceRuleSeedCollectionAggregate,
): SourceRuleSeedCollectionAggregate {
    const factsById = new Map<string, TaintFact>();
    for (const fact of [...left.facts, ...right.facts]) {
        if (!factsById.has(fact.taintId)) {
            factsById.set(fact.taintId, fact);
        }
    }

    const sourceRuleHits: Record<string, number> = {};
    for (const hits of [left.sourceRuleHits, right.sourceRuleHits]) {
        for (const [ruleId, count] of Object.entries(hits)) {
            sourceRuleHits[ruleId] = (sourceRuleHits[ruleId] || 0) + (Number(count) || 0);
        }
    }

    return {
        facts: [...factsById.values()],
        seededLocals: [...new Set([...left.seededLocals, ...right.seededLocals])].sort(),
        sourceRuleHits,
        activatedMethodSignatures: [...new Set([
            ...left.activatedMethodSignatures,
            ...right.activatedMethodSignatures,
        ])].sort(),
        sourceSeedAudit: [...left.sourceSeedAudit, ...right.sourceSeedAudit],
        sourceRuleZeroHitAudit: [...left.sourceRuleZeroHitAudit, ...right.sourceRuleZeroHitAudit],
        passCount: left.passCount + right.passCount,
        endpointResolutionAudit: [...left.endpointResolutionAudit, ...right.endpointResolutionAudit],
    };
}

function summarizeEndpointResolutionStatuses(
    records: readonly EndpointResolutionLedgerItem[],
): Partial<Record<EndpointResolutionStatus, number>> {
    const out: Partial<Record<EndpointResolutionStatus, number>> = {};
    for (const record of records) {
        out[record.status] = (out[record.status] || 0) + 1;
    }
    return out;
}

function safeMethodSignatureText(method: any): string {
    try {
        return method?.getSignature?.()?.toString?.() || "";
    } catch {
        return "";
    }
}

function collectKnownFrameworkCallbackMethodSignaturesFromMethod(scene: Scene, method: ArkMethod): string[] {
    const cfg = method.getCfg?.();
    if (!cfg) return [];

    const out = new Set<string>();
    const reachableCallbackResolveMaxDepth = 0;
    for (const stmt of cfg.getStmts()) {
        if (!stmt.containsInvokeExpr?.()) continue;
        if (!shouldInspectFrameworkCallbackStmt(stmt)) continue;
        const registrations = resolveCallbackRegistrationsFromStmt(
            stmt,
            scene,
            method,
            args => resolveKnownFrameworkCallbackRegistration(args),
            { maxDepth: reachableCallbackResolveMaxDepth },
        );
        for (const registration of registrations) {
            const signature = safeMethodSignatureText(registration.callbackMethod);
            if (!signature) continue;
            out.add(signature);
        }
        for (const registration of resolveKnownControllerOptionCallbackRegistrationsFromStmt(stmt, scene, method)) {
            const signature = safeMethodSignatureText(registration.callbackMethod);
            if (!signature) continue;
            out.add(signature);
        }
    }
    return [...out.values()];
}

function shouldInspectFrameworkCallbackStmt(stmt: any): boolean {
    const invokeExpr = stmt?.getInvokeExpr?.();
    if (!invokeExpr) return false;
    const methodName = invokeExpr?.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || "";
    if (isKnownFrameworkCallbackMethodName(methodName)) return true;
    const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
    return args.some(isFrameworkCallbackLikeArg);
}

function isFrameworkCallbackLikeArg(value: any): boolean {
    if (!value) return false;
    return isCallableValue(value);
}

function isThisReceiverInvokeForReachability(invokeExpr: any): boolean {
    const base = typeof invokeExpr?.getBase === "function" ? invokeExpr.getBase() : undefined;
    return base?.getName?.() === "this";
}

function safeValueText(value: any): string {
    try {
        return String(value?.toString?.() || value || "");
    } catch {
        return "";
    }
}

