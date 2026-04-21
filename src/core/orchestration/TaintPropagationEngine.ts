import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { PointerAnalysis } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/PointerAnalysis";
import { PointerAnalysisConfig } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/PointerAnalysisConfig";
import { Pag, PagNode } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { CallGraph } from "../../../arkanalyzer/out/src/callgraph/model/CallGraph";
import { CallGraphBuilder } from "../../../arkanalyzer/out/src/callgraph/model/builder/CallGraphBuilder";
import { ArkAssignStmt } from "../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkInstanceFieldRef } from "../../../arkanalyzer/out/src/core/base/Ref";
import { Local } from "../../../arkanalyzer/out/src/core/base/Local";
import { ArkInstanceInvokeExpr, ArkStaticInvokeExpr } from "../../../arkanalyzer/out/src/core/base/Expr";
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
    materializeAllSyntheticInvokeSites,
    SyntheticInvokeEdgeInfo,
    SyntheticConstructorStoreInfo,
    SyntheticFieldBridgeInfo,
    SyntheticStaticInitStoreInfo,
    SyntheticInvokeLazyMaterializer
} from "../kernel/builders/SyntheticInvokeEdgeBuilder";
import { FactRuleChain, WorklistSolver, WorklistSolverDeps } from "../kernel/propagation/WorklistSolver";
import {
    createEmptySinkDetectProfile,
    detectSinks as runSinkDetector,
    mergeSinkDetectProfiles,
    SinkDetectProfile,
} from "../kernel/rules/SinkDetector";
import { collectSourceRuleSeeds as collectSourceRuleSeedsFromRules } from "../kernel/rules/SourceRuleSeedCollector";
import { resolveSinkRuleSignatures as resolveSinkRuleSignaturesByRule } from "../kernel/rules/SinkRuleSignatureResolver";
import { createDebugCollectors, dumpDebugArtifactsToDir } from "../kernel/debug/DebugArtifactUtils";
import { WorklistProfiler, WorklistProfileSnapshot } from "../kernel/debug/WorklistProfiler";
import { PropagationTrace } from "../kernel/debug/PropagationTrace";
import {
    expandEntryMethodsByDirectCalls,
    expandMethodsByDirectCalls,
} from "../entry/shared/ExplicitEntryScopeResolver";
import {
    collectKnownKeyedDispatchKeysFromMethod,
    resolveKnownKeyedCallbackRegistrationsFromStmt,
} from "../entry/shared/FrameworkCallbackClassifier";
import {
    collectParameterAssignStmts,
    resolveMethodsFromCallable,
} from "../substrate/queries/CalleeResolver";
import { collectFiniteStringCandidatesFromValue } from "../substrate/queries/FiniteStringCandidateResolver";
import { collectOrdinaryHigherOrderCallbackMethodSignaturesFromMethod } from "../kernel/ordinary/OrdinaryArrayPropagation";
import { buildArkMainPlan } from "../entry/arkmain/ArkMainPlanner";
import { ArkMainEntryFact } from "../entry/arkmain/ArkMainTypes";
import { ArkMainSyntheticRootBuilder } from "../entry/arkmain/ArkMainSyntheticRootBuilder";
import {
    emptyModuleAuditSnapshot,
    ModuleAuditSnapshot,
    ModuleRuntime,
    TaintModule,
} from "../kernel/contracts/ModuleContract";
import type { ModuleSpec } from "../kernel/contracts/ModuleSpec";
import type { InternalModuleQueryApi } from "../kernel/contracts/ModuleInternal";
import {
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
    BaseRule,
    RuleEndpoint,
    RuleEndpointOrRef,
    RuleInvokeKind,
    SanitizerRule,
    SinkRule,
    SourceRule,
    TransferRule,
    normalizeEndpoint,
} from "../rules/RuleSchema";
import { normalizeRuleGovernance } from "../rules/RuleGovernance";
import {
    orderRulesByFamilyTier,
    resolveRuleFamily,
    resolveRuleTierWeight,
} from "../rules/RulePriority";

export interface DebugOptions {
    enableWorklistProfile?: boolean;
    enablePropagationTrace?: boolean;
    propagationTraceMaxEdges?: number;
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
    adaptiveContext?: AdaptiveContextSelectorOptions;
    transferRules?: TransferRule[];
    moduleSpecFiles?: string[];
    moduleSpecs?: ModuleSpec[];
    modules?: TaintModule[];
    moduleRoots?: string[];
    moduleFiles?: string[];
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

export interface RuleHitCounters {
    source: Record<string, number>;
    sink: Record<string, number>;
    transfer: Record<string, number>;
}

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
    captureLazyMaterializer?: CaptureLazyMaterializer;
    syntheticInvokeLazyMaterializer?: SyntheticInvokeLazyMaterializer;
    captureEdgeMapReady: boolean;
    syntheticInvokeEdgeMapReady: boolean;
    executionHandoffSnapshot?: ExecutionHandoffContractSnapshot;
    executionHandoffDeferredSiteKeys?: Set<string>;
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
    private captureLazyMaterializer?: CaptureLazyMaterializer;
    private syntheticInvokeLazyMaterializer?: SyntheticInvokeLazyMaterializer;
    private adaptiveContextSelector?: AdaptiveContextSelector;
    private worklistProfiler?: WorklistProfiler;
    private propagationTrace?: PropagationTrace;
    private options: TaintEngineOptions;
    private modules: TaintModule[];
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
    private keyedRouteMismatchCache: Map<string, boolean> = new Map();
    private routePushKeyCache: Map<string, Set<string>> = new Map();
    private activePagCacheEntry?: PagBuildCacheEntry;
    private executionHandoffSnapshot?: ExecutionHandoffContractSnapshot;
    private executionHandoffDeferredSiteKeys?: Set<string>;
    private currentEntryModel: EntryModel = "arkMain";
    private arkMainSeedReport?: ArkMainSeedReport;

    public verbose: boolean = true;

    constructor(scene: Scene, k: number = 1, options: TaintEngineOptions = {}) {
        this.scene = scene;
        this.tracker = new TaintTracker();
        this.ctxManager = new TaintContextManager(k);
        this.options = options;
        this.modules = this.initializeModules(options);
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
            moduleSpecFiles: options.moduleSpecFiles,
            moduleSpecs: options.moduleSpecs,
            modules: options.modules,
            enabledModuleProjects: options.enabledModuleProjects,
            disabledModuleProjects: options.disabledModuleProjects,
            onWarning: (warning) => this.log(`module warning: ${warning}`),
        });
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

    private log(msg: string): void {
        if (this.verbose) console.log(msg);
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
        const reachableKey = this.activeReachableMethodSignatures
            ? [...this.activeReachableMethodSignatures].sort().join("||")
            : "*";
        const nextKey = reachableKey;
        if (this.moduleRuntime && this.moduleRuntimePag === this.pag && this.moduleRuntimeKey === nextKey) {
            return;
        }
        this.moduleRuntime = createModuleRuntime(this.modules, {
            scene: this.scene,
            pag: this.pag,
            allowedMethodSignatures: this.activeReachableMethodSignatures,
            fieldToVarIndex: this.fieldToVarIndex,
            queries: {
                resolveMethodsFromCallable,
                collectParameterAssignStmts,
                collectFiniteStringCandidatesFromValue,
            },
            log: this.log.bind(this),
        });
        this.moduleRuntimeKey = nextKey;
        this.moduleRuntimePag = this.pag;
        if (this.activePagCacheEntry && this.cg && this.pag) {
            this.rebuildExecutionHandoffLayer(this.activePagCacheEntry);
        }
    }

    public getPagNodeResolutionAuditSnapshot(): PagNodeResolutionAuditSnapshot {
        if (!this.pag) {
            return {
                requestCount: 0,
                directHitCount: 0,
                fallbackResolveCount: 0,
                awaitFallbackCount: 0,
                exprUseFallbackCount: 0,
                anchorLeftFallbackCount: 0,
                addAttemptCount: 0,
                addFailureCount: 0,
                unresolvedCount: 0,
                unsupportedValueKinds: {},
            };
        }
        return getPagNodeResolutionAuditSnapshot(this.pag);
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

    private configureExecutionHandoffLayer(cacheEntry: PagBuildCacheEntry): void {
        this.refreshModuleRuntime();
        this.rebuildExecutionHandoffLayer(cacheEntry);
    }

    private rebuildExecutionHandoffLayer(cacheEntry: PagBuildCacheEntry): void {
        const contracts = buildExecutionHandoffContracts(
            this.scene,
            this.cg,
            this.pag,
            this.moduleRuntime?.getDeferredBindingDeclarations() || [],
        );
        const deferredSiteKeys = new Set<string>();
        for (const contract of contracts) {
            const siteKey = buildExecutionHandoffSiteKeyFromRecord(contract);
            deferredSiteKeys.add(siteKey);
        }

        this.executionHandoffDeferredSiteKeys = deferredSiteKeys;
        cacheEntry.executionHandoffDeferredSiteKeys = new Set(deferredSiteKeys);

        const snapshot = buildExecutionHandoffSnapshot(contracts);
        this.executionHandoffSnapshot = snapshot;
        cacheEntry.executionHandoffSnapshot = this.cloneExecutionHandoffSnapshot(snapshot);
        this.log(`[ExecutionHandoff] contracts=${snapshot.totalContracts}`);

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
                ].join("|");
                if (seen.has(key)) continue;
                seen.add(key);
                dest.push(edge);
            }
        }
    }

    private parseSourceRuleId(source: string): string | undefined {
        if (!source.startsWith("source_rule:")) return undefined;
        const id = source.slice("source_rule:".length).trim();
        return id.length > 0 ? id : undefined;
    }

    private orderRulesByFamilyTier<T extends BaseRule>(rules: T[]): T[] {
        return orderRulesByFamilyTier(rules);
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
    }

    public resetPropagationState(): void {
        this.tracker.clear();
        this.observedFacts.clear();
        this.lastEnginePluginFindings = [];
        this.clearFactRuleChains();
        this.clearRuleHits();
        this.resetDetectProfile();
    }

    public resetDetectProfile(): void {
        this.detectProfile = createEmptySinkDetectProfile();
    }

    public getDetectProfile(): DetectProfileSnapshot {
        return { ...this.detectProfile };
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

    public async buildPAG(options: BuildPAGOptions = {}): Promise<void> {
        this.resetPropagationState();
        this.moduleRuntime = undefined;
        this.moduleRuntimeKey = undefined;
        this.moduleRuntimePag = undefined;
        this.executionHandoffSnapshot = undefined;

        const entryModel: EntryModel = options.entryModel || "arkMain";
        this.currentEntryModel = entryModel;
        const explicitSyntheticEntries = this.normalizeSyntheticEntryMethods(options.syntheticEntryMethods);
        this.explicitEntryScopeMethodSignatures = this.resolveExplicitEntryScope(explicitSyntheticEntries);
        const arkMainPlan = entryModel === "arkMain"
            ? buildArkMainPlan(this.scene, {
                seedMethods: explicitSyntheticEntries,
                seededMethods: this.options.arkMainSeeds?.methods,
                seededFacts: this.options.arkMainSeeds?.facts,
            })
            : undefined;
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
        this.activeOrderedMethodSignatures = entryModel === "arkMain"
            ? (arkMainPlan?.orderedMethods || []).map(method => method?.getSignature?.()?.toString?.()).filter((sig): sig is string => !!sig)
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
            )
            : explicitSyntheticEntries;
        const syntheticKey = syntheticEntryMethods.length > 0
            ? `synthetic|${syntheticEntryMethods.map(method => method.getSignature().toString()).join("||")}`
            : "pure";
        const cacheKey = `entryModel|${entryModel}|${syntheticKey}|modules|${this.buildModulePlanCacheKey()}`;
        const sceneCache = this.getPagBuildCacheForScene();
        const cached = sceneCache.get(cacheKey);
        if (cached) {
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
            this.log(`PAG nodes: ${this.pag.getNodeNum()}, edges: ${this.pag.getEdgeNum()}`);
            this.log(`CG nodes: ${this.cg.getNodeNum()}, edges: ${this.cg.getEdgeNum()}`);
            this.configureContextStrategy();
            this.setActiveReachableMethodSignatures(this.computeReachableMethodSignatures());
            return;
        }

        const cg = new CallGraph(this.scene);
        const cgBuilder = new CallGraphBuilder(cg, this.scene);
        cgBuilder.buildDirectCallGraphForScene();
        const pag = new Pag();
        resetPagNodeResolutionAudit(pag);
        const config = PointerAnalysisConfig.create(0, "./out", false, false, false);
        this.pta = new PointerAnalysis(pag, cg, this.scene, config);
        const { syntheticRootMethod, cleanup } = this.createSyntheticEntry(entryModel, syntheticEntryMethods);
        try {
            cgBuilder.buildDirectCallGraph([syntheticRootMethod]);
            const syntheticRootMethodId = cg.getCallGraphNodeByMethod(syntheticRootMethod.getSignature()).getID();
            cg.setDummyMainFuncID(syntheticRootMethodId);
            this.pta.setEntries([syntheticRootMethodId]);
            this.pta.start();
        } finally {
            cleanup();
        }
        this.pag = this.pta.getPag();
        this.cg = cg;

        this.log(`PAG nodes: ${this.pag.getNodeNum()}, edges: ${this.pag.getEdgeNum()}`);
        this.log(`CG nodes: ${this.cg.getNodeNum()}, edges: ${this.cg.getEdgeNum()}`);

        this.fieldToVarIndex = buildFieldToVarIndex(this.pag, this.log.bind(this));
        this.callEdgeMap = buildCallEdgeMap(this.scene, this.cg, this.pag, this.log.bind(this));
        this.receiverFieldBridgeMap = buildReceiverFieldBridgeMap(this.scene, this.cg, this.pag, this.log.bind(this));
        this.captureEdgeMap = new Map<number, CaptureEdgeInfo[]>();
        this.syntheticInvokeEdgeMap = new Map<number, SyntheticInvokeEdgeInfo[]>();
        this.syntheticConstructorStoreMap = buildSyntheticConstructorStoreMap(this.scene, this.cg, this.pag, this.log.bind(this));
        this.syntheticStaticInitStoreMap = buildSyntheticStaticInitStoreMap(this.scene, this.cg, this.pag, this.log.bind(this));
        this.syntheticFieldBridgeMap = buildSyntheticFieldBridgeMap(this.scene, this.cg, this.pag, this.log.bind(this));
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
            captureLazyMaterializer: undefined,
            syntheticInvokeLazyMaterializer: undefined,
            captureEdgeMapReady: false,
            syntheticInvokeEdgeMapReady: false,
            executionHandoffSnapshot: undefined,
            executionHandoffDeferredSiteKeys: undefined,
        };
        this.activePagCacheEntry = cacheEntry;
        this.configureExecutionHandoffLayer(cacheEntry);
        this.captureLazyMaterializer = buildCaptureLazyMaterializer(
            this.scene,
            this.cg,
            this.pag,
            this.executionHandoffDeferredSiteKeys,
        );
        this.syntheticInvokeLazyMaterializer = buildSyntheticInvokeLazyMaterializer(this.scene, this.cg, this.pag, this.log.bind(this));
        cacheEntry.captureLazyMaterializer = this.captureLazyMaterializer;
        cacheEntry.syntheticInvokeLazyMaterializer = this.syntheticInvokeLazyMaterializer;
        sceneCache.set(cacheKey, cacheEntry);
        this.configureContextStrategy();
        this.setActiveReachableMethodSignatures(this.computeReachableMethodSignatures());
    }

    private resolveSyntheticEntryMethods(
        explicitSyntheticEntries: ArkMethod[],
        entryModel: EntryModel,
        arkMainPlan?: ReturnType<typeof buildArkMainPlan>,
    ): ArkMethod[] {
        const defaultEntries = this.mergeSyntheticEntryMethods(
            explicitSyntheticEntries,
            (arkMainPlan || buildArkMainPlan(this.scene, { seedMethods: explicitSyntheticEntries })).orderedMethods,
        );
        return this.enginePluginRuntime.resolveEntries(defaultEntries, {
            discover: () => ({
                orderedMethods: [...defaultEntries],
            }),
        });
    }

    private normalizeSyntheticEntryMethods(methods?: ArkMethod[]): ArkMethod[] {
        if (!methods || methods.length === 0) return [];
        const dedup = new Map<string, ArkMethod>();
        for (const method of methods) {
            const signature = method?.getSignature?.()?.toString?.();
            if (!signature || dedup.has(signature)) continue;
            dedup.set(signature, method);
        }
        return [...dedup.values()];
    }

    private mergeSyntheticEntryMethods(primary: ArkMethod[], extra: ArkMethod[]): ArkMethod[] {
        const dedup = new Map<string, ArkMethod>();
        for (const method of [...primary, ...extra]) {
            const signature = method?.getSignature?.()?.toString?.();
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

    public computeReachableMethodSignatures(): Set<string> {
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

        for (let head = 0; head < queue.length; head++) {
            const nodeId = queue[head];
            if (visited.has(nodeId)) continue;
            visited.add(nodeId);

            const methodSig = this.cg.getMethodByFuncID(nodeId);
            if (methodSig) {
                reachable.add(methodSig.toString());
            }

            const node = this.cg.getNode(nodeId);
            if (!node) continue;
            for (const edge of node.getOutgoingEdges()) {
                const dstSignature = this.cg.getMethodByFuncID(edge.getDstID())?.toString?.();
                if (dstSignature && deferredUnitSignatures.has(dstSignature)) {
                    continue;
                }
                queue.push(edge.getDstID());
            }
        }

        this.ensureAllSyntheticInvokeEdgesMaterialized();
        const syntheticAdj = new Map<string, Set<string>>();
        for (const edges of this.syntheticInvokeEdgeMap.values()) {
            for (const edge of edges) {
                if (edge.type !== CallEdgeType.CALL) continue;
                if (!edge.callerSignature || !edge.calleeSignature) continue;
                if (!syntheticAdj.has(edge.callerSignature)) {
                    syntheticAdj.set(edge.callerSignature, new Set());
                }
                syntheticAdj.get(edge.callerSignature)!.add(edge.calleeSignature);
            }
        }
        const syntheticQueue = [...reachable];
        const syntheticVisited = new Set<string>(reachable);
        for (let head = 0; head < syntheticQueue.length; head++) {
            const sig = syntheticQueue[head];
            const callees = syntheticAdj.get(sig);
            if (!callees) continue;
            for (const callee of callees) {
                if (syntheticVisited.has(callee)) continue;
                syntheticVisited.add(callee);
                reachable.add(callee);
                syntheticQueue.push(callee);
            }
        }

        const reachableMethods = this.scene.getMethods().filter(method => {
            const signature = method?.getSignature?.()?.toString?.();
            return !!signature && reachable.has(signature);
        });
        for (const method of expandMethodsByDirectCalls(this.scene, reachableMethods, {
            includeKeyedDispatchCallbacks: false,
        })) {
            const signature = method?.getSignature?.()?.toString?.();
            if (!signature) continue;
            reachable.add(signature);
        }

        const methodsBySig = new Map<string, ArkMethod>();
        for (const method of this.scene.getMethods()) {
            const signature = method?.getSignature?.()?.toString?.();
            if (!signature) continue;
            methodsBySig.set(signature, method);
        }
        const ordinaryCallbackQueue = [...reachable];
        const ordinaryCallbackVisited = new Set<string>(reachable);
        for (let head = 0; head < ordinaryCallbackQueue.length; head++) {
            const signature = ordinaryCallbackQueue[head];
            const method = methodsBySig.get(signature);
            if (!method) continue;
            for (const callbackSignature of collectOrdinaryHigherOrderCallbackMethodSignaturesFromMethod(this.scene, method)) {
                if (ordinaryCallbackVisited.has(callbackSignature)) continue;
                ordinaryCallbackVisited.add(callbackSignature);
                reachable.add(callbackSignature);
                ordinaryCallbackQueue.push(callbackSignature);
            }
        }

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
                this.tracker.markTainted(nodeId, emptyCtx, sourceSignature, undefined, fact.id);
                this.upsertFactRuleChain(fact.id, this.initialFlowRuleChainForFact(fact));
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
            if (visited.has(fact.id)) continue;
            visited.add(fact.id);
            worklist.push(fact);
            this.tracker.markTainted(fact.node.getID(), fact.contextID, fact.source, fact.field, fact.id);
            this.upsertFactRuleChain(fact.id, this.initialFlowRuleChainForFact(fact));
        }

        this.log(`Initialized WorkList with ${worklist.length} seeds.`);
        this.runWorkList(worklist, visited);
    }

    public propagateWithSourceRules(
        sourceRules: SourceRule[]
    ): { seedCount: number; seededLocals: string[]; sourceRuleHits: Record<string, number> } {
        this.clearRuleHits("source");
        const pluginSourceRules = this.normalizeRuntimeSourceRules(
            this.enginePluginRuntime.getAdditionalSourceRules(),
            "plugin_runtime",
        );
        const effectiveSourceRules = this.mergeAutoEntrySourceRules([
            ...this.normalizeRuntimeSourceRules(sourceRules || [], "runtime_project"),
            ...pluginSourceRules,
        ]);
        let ruleSeeds = this.collectSourceRuleSeeds(effectiveSourceRules, this.activeReachableMethodSignatures);
        if (ruleSeeds.activatedMethodSignatures.length > 0) {
            const mergedReachable = new Set<string>(this.activeReachableMethodSignatures || []);
            for (const sig of ruleSeeds.activatedMethodSignatures) {
                mergedReachable.add(sig);
            }
            // NOTE: flow-insensitive propagation does not model event-loop ordering.
            // We expand reachable methods to activate callback bodies discovered at registration sites.
            this.setActiveReachableMethodSignatures(mergedReachable);
        }
        const mergedFacts = new Map<string, TaintFact>();
        for (const fact of ruleSeeds.facts) {
            if (!mergedFacts.has(fact.id)) {
                mergedFacts.set(fact.id, fact);
            }
        }
        const seededLocals = new Set<string>(ruleSeeds.seededLocals);

        for (const [ruleId, hitCount] of Object.entries(ruleSeeds.sourceRuleHits)) {
            this.markRuleHit("source", ruleId, Number(hitCount) || 0);
        }
        if (mergedFacts.size === 0) {
            this.log("No source seeds matched by source rules.");
            return {
                seedCount: 0,
                seededLocals: [],
                sourceRuleHits: this.toRecord(this.ruleHits.source),
            };
        }

        this.log(`Initialized WorkList with ${mergedFacts.size} source-rule seeds.`);
        const sourceHitEntries = Object.entries(ruleSeeds.sourceRuleHits);
        this.propagateWithFacts(Array.from(mergedFacts.values()));
        for (const [ruleId, hitCount] of sourceHitEntries) {
            this.markRuleHit("source", ruleId, Number(hitCount) || 0);
        }
        return {
            seedCount: mergedFacts.size,
            seededLocals: [...seededLocals].sort(),
            sourceRuleHits: this.toRecord(this.ruleHits.source),
        };
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
                scope: rule.scope ? { ...rule.scope } : undefined,
                calleeScope: rule.calleeScope ? { ...rule.calleeScope } : undefined,
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
        const effectiveSinkRules = this.orderRulesByFamilyTier([
            ...this.normalizeRuntimeSinkRules(sinkRules || [], "runtime_project"),
            ...this.normalizeRuntimeSinkRules(this.enginePluginRuntime.getAdditionalSinkRules(), "plugin_runtime"),
        ]);
        const effectiveSanitizerRules = this.orderRulesByFamilyTier([
            ...this.normalizeRuntimeSanitizerRules(options?.sanitizerRules || [], "runtime_project"),
            ...this.normalizeRuntimeSanitizerRules(this.enginePluginRuntime.getAdditionalSanitizerRules(), "plugin_runtime"),
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
        return finalized;
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
            });
        };
        const buildDetectCacheKey = (
            signature: string,
            target: {
                targetEndpoint?: RuleEndpoint;
                targetPath?: string[];
                invokeKind?: RuleInvokeKind;
                argCount?: number;
                typeHint?: string;
            },
            signatureMatchMode: "contains" | "equals"
        ): string => {
            const endpoint = target.targetEndpoint || "";
            const path = target.targetPath && target.targetPath.length > 0
                ? target.targetPath.join(".")
                : "";
            const invokeKind = target.invokeKind || "";
            const argCount = target.argCount === undefined ? "" : String(target.argCount);
            const typeHint = target.typeHint || "";
            return `${signature}|${endpoint}|${path}|${invokeKind}|${argCount}|${typeHint}|${signatureMatchMode}`;
        };
        const buildFlowDedupKey = (flow: TaintFlow): string => {
            const sinkMethodSig = flow.sink?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.() || "";
            const sinkNodeId = flow.sinkNodeId === undefined ? "" : String(flow.sinkNodeId);
            const sinkFieldPath = flow.sinkFieldPath && flow.sinkFieldPath.length > 0
                ? flow.sinkFieldPath.join(".")
                : "";
            return `${flow.source} -> ${sinkMethodSig} -> ${flow.sink.toString()} -> ${sinkNodeId} -> ${sinkFieldPath}`;
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

        const orderedSinkRules = this.orderRulesByFamilyTier(sinkRules);
        const bestTierBySignatureFamily = new Map<string, number>();
        for (const rule of orderedSinkRules) {
            if (reachedFlowLimit()) break;
            const signatures = resolveSinkRuleSignaturesByRule(this.scene, rule);
            const target = this.resolveSinkRuleTarget(rule);
            const signatureMatchMode = this.resolveSinkSignatureMatchMode(rule);
            const sinkEndpoint = target.targetEndpoint || "any_arg";
            const sinkPathSuffix = target.targetPath && target.targetPath.length > 0
                ? `.${target.targetPath.join(".")}`
                : "";
            const family = resolveRuleFamily(rule);
            const tier = resolveRuleTierWeight(rule);
            for (const signature of signatures) {
                const cacheKey = buildDetectCacheKey(signature, target, signatureMatchMode);
                const signatureFamilyKey = family ? `${signature}|${family}` : "";
                const bestTier = signatureFamilyKey
                    ? (bestTierBySignatureFamily.get(signatureFamilyKey) || 0)
                    : 0;
                if (signatureFamilyKey && tier < bestTier) {
                    continue;
                }
                if (signatureFamilyKey && tier > bestTier) {
                    bestTierBySignatureFamily.set(signatureFamilyKey, tier);
                }
                let flows: TaintFlow[];
                const cached = detectCache.get(cacheKey);
                if (cached) {
                    flows = cached.map(cloneFlow);
                } else {
                    const computed = this.detectSinks(signature, {
                        ...target,
                        signatureMatchMode,
                        sanitizerRules: options?.sanitizerRules || [],
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
                    }
                }
                flows = flows.filter(flow =>
                    !this.shouldSuppressSafeOverwriteFlow(flow)
                    && !this.shouldSuppressKeyedRouteCallbackMismatchFlow(flow)
                );
                if (family) {
                    flows = flows.filter(flow => {
                        const actualSignature = this.resolveSinkFlowCalleeSignature(flow);
                        if (!actualSignature) return true;
                        const actualSignatureFamilyKey = `${actualSignature}|${family}`;
                        const bestActualTier = bestTierBySignatureFamily.get(actualSignatureFamilyKey) || 0;
                        return tier >= bestActualTier;
                    });
                }
                addFlows(rule.id, flows);
                if (reachedFlowLimit()) break;
            }
        }

        return Array.from(flowMap.values());
    }

    private runWorkList(worklist: TaintFact[], visited: Set<string>): void {
        this.prepareDebugCollectors();
        const orderedTransferRules = this.orderRulesByFamilyTier([
            ...this.normalizeRuntimeTransferRules(this.options.transferRules || [], "runtime_project"),
            ...this.normalizeRuntimeTransferRules(this.enginePluginRuntime.getAdditionalTransferRules(), "plugin_runtime"),
        ]);
        const propagationHooks = this.enginePluginRuntime.beginPropagation({
            pag: this.pag,
        });
        const deps = this.buildWorklistSolverDeps(orderedTransferRules, propagationHooks);
        propagationHooks.run(
            { worklist, visited, deps },
            {
                run: (input) => {
                    const solver = new WorklistSolver(input.deps);
                    solver.solve(input.worklist, input.visited);
                    return {
                        visitedCount: input.visited.size,
                    };
                },
            },
        );
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
        });
        this.moduleRuntime = moduleRuntime;
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
            onTransferRuleHit: (event) => this.markRuleHit("transfer", event.ruleId, 1),
            getInitialRuleChainForFact: (fact) => this.initialFlowRuleChainForFact(fact),
            onFactRuleChain: (factId, chain) => this.upsertFactRuleChain(factId, chain),
            profiler: this.worklistProfiler,
            propagationTrace: this.propagationTrace,
            allowedMethodSignatures: this.activeReachableMethodSignatures,
            moduleRuntime,
            moduleQueries,
            onFactObserved: (fact) => this.recordObservedFact(fact),
            onCallEdge: (event) => propagationHooks.onCallEdge(event),
            onTaintFlow: (event) => propagationHooks.onTaintFlow(event),
            onMethodReached: (event) => propagationHooks.onMethodReached(event),
            log: this.log.bind(this),
        };
    }

    private recordObservedFact(fact: TaintFact): void {
        this.observedFacts.set(fact.id, fact);
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
            detectSinks: (signature: string, options?: { targetEndpoint?: string; targetPath?: string[] }) => {
                return this.detectSinks(signature, {
                    targetEndpoint: options?.targetEndpoint as RuleEndpoint | undefined,
                    targetPath: options?.targetPath,
                    sanitizerRules,
                });
            },
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
            );
            cacheEntry.syntheticInvokeEdgeMapReady = true;
            this.syntheticInvokeEdgeMap = cacheEntry.syntheticInvokeEdgeMap;
        }
        return this.syntheticInvokeEdgeMap.get(nodeId);
    }

    private ensureAllSyntheticInvokeEdgesMaterialized(): void {
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
    } {
        return collectSourceRuleSeedsFromRules({
            scene: this.scene,
            pag: this.pag,
            sourceRules: this.orderRulesByFamilyTier(sourceRules || []),
            emptyContextId: this.ctxManager.getEmptyContextID(),
            allowedMethodSignatures,
        });
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
        return (sourceRules || []).map(rule => normalizeRuleGovernance(rule, { kind: origin }, "source"));
    }

    private normalizeRuntimeSinkRules(
        sinkRules: SinkRule[],
        origin: "runtime_project" | "plugin_runtime",
    ): SinkRule[] {
        return (sinkRules || []).map(rule => normalizeRuleGovernance(rule, { kind: origin }, "sink"));
    }

    private normalizeRuntimeSanitizerRules(
        sanitizerRules: SanitizerRule[],
        origin: "runtime_project" | "plugin_runtime",
    ): SanitizerRule[] {
        return (sanitizerRules || []).map(rule => normalizeRuleGovernance(rule, { kind: origin }, "sanitizer"));
    }

    private normalizeRuntimeTransferRules(
        transferRules: TransferRule[],
        origin: "runtime_project" | "plugin_runtime",
    ): TransferRule[] {
        return (transferRules || []).map(rule => normalizeRuleGovernance(rule, { kind: origin }, "transfer"));
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
            const methodSig = declaringMethod?.getSignature?.()?.toString?.();
            if (methodSig) {
                recovered.add(methodSig);
            }
            const clsName = declaringMethod?.getDeclaringArkClass?.()?.getName?.();
            if (clsName) {
                recoveredClassNames.add(clsName);
            }
            const methodSigText = declaringMethod?.getSignature?.()?.toString?.() || "";
            const filePath = extractFilePathFromSignature(methodSigText);
            if (filePath) {
                recoveredFilePaths.add(filePath);
            }
        }
        if (recoveredClassNames.size > 0) {
            for (const method of this.scene.getMethods()) {
                const clsName = method.getDeclaringArkClass?.()?.getName?.();
                if (!clsName || !recoveredClassNames.has(clsName)) continue;
                const sig = method.getSignature?.()?.toString?.();
                if (sig) {
                    recovered.add(sig);
                }
            }
        }
        if (recoveredFilePaths.size > 0) {
            for (const method of this.scene.getMethods()) {
                const sig = method.getSignature?.()?.toString?.() || "";
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
        if (!arkMainPlan) {
            return [];
        }

        const out = new Map<string, SourceRule>();
        for (const rule of arkMainPlan.sourceRules || []) {
            if (!rule?.id || out.has(rule.id)) continue;
            out.set(rule.id, rule);
        }
        return [...out.values()];
    }

    private buildAmbientFrameworkSourceRules(
        arkMainPlan?: ReturnType<typeof buildArkMainPlan>,
    ): SourceRule[] {
        const out = new Map<string, SourceRule>();
        const allMethods = this.scene.getMethods().filter(method => method.getName() !== "%dflt");

        const addRule = (rule: SourceRule): void => {
            if (!rule?.id || out.has(rule.id)) return;
            out.set(rule.id, rule);
        };

        const addGlobalCallReturnRule = (
            family: string,
            description: string,
            methodSignature: string,
        ): void => {
            addRule({
                id: `source.auto.framework.${family}.${methodSignature}`,
                enabled: true,
                family: `source.auto.framework.${family}`,
                tier: "A",
                description,
                tags: ["framework_source", "auto", family],
                match: {
                    kind: "signature_equals",
                    value: methodSignature,
                },
                sourceKind: "call_return",
                target: {
                    endpoint: "result",
                },
            });
        };

        const navigationGetterSignatures = allMethods
            .filter(method => {
                const signature = method.getSignature?.();
                const methodName = signature?.getMethodSubSignature?.()?.getMethodName?.() || method.getName?.() || "";
                const className = signature?.getDeclaringClassSignature?.()?.getClassName?.() || "";
                return methodName === "getParams" && (className === "Router" || className === "NavPathStack");
            })
            .map(method => method.getSignature().toString());
        for (const signature of navigationGetterSignatures) {
            addGlobalCallReturnRule(
                "navigation_context",
                `[auto framework] ambient navigation context from ${signature}`,
                signature,
            );
        }

        const lifecycleFacts = arkMainPlan?.facts || [];
        const lifecycleOwnerMethods = new Map<string, { className: string; methodName: string }>();
        for (const fact of lifecycleFacts) {
            const methodSignature = fact.method.getSignature?.()?.toString?.();
            const className = fact.method.getDeclaringArkClass?.()?.getName?.() || "";
            const methodName = fact.method.getName?.() || "";
            if (!methodSignature || !className || !methodName) continue;
            lifecycleOwnerMethods.set(methodSignature, { className, methodName });
        }

        const systemContextGetterSignatures = allMethods
            .filter(method => {
                const signature = method.getSignature?.();
                const methodName = signature?.getMethodSubSignature?.()?.getMethodName?.() || method.getName?.() || "";
                const className = signature?.getDeclaringClassSignature?.()?.getClassName?.() || "";
                return methodName === "getContext" && className === "SystemEnv";
            })
            .map(method => method.getSignature().toString());
        for (const getterSignature of systemContextGetterSignatures) {
            for (const [ownerSignature, ownerMeta] of lifecycleOwnerMethods.entries()) {
                if (ownerMeta.methodName !== "onCreate") continue;
                addRule({
                    id: `source.auto.framework.system_context.${ownerSignature}.${getterSignature}`,
                    enabled: true,
                    family: "source.auto.framework.system_context",
                    tier: "A",
                    description: `[auto framework] system context in ${ownerSignature}`,
                    tags: ["framework_source", "auto", "system_context", "lifecycle"],
                    match: {
                        kind: "signature_equals",
                        value: getterSignature,
                    },
                    scope: {
                        className: { mode: "equals", value: ownerMeta.className },
                        methodName: { mode: "equals", value: ownerMeta.methodName },
                    },
                    sourceKind: "call_return",
                    target: {
                        endpoint: "result",
                    },
                });
            }
        }

        return [...out.values()];
    }

    public detectSinks(
        sinkSignature: string,
        options?: {
            targetEndpoint?: RuleEndpoint;
            targetPath?: string[];
            invokeKind?: RuleInvokeKind;
            argCount?: number;
            typeHint?: string;
            signatureMatchMode?: "contains" | "equals";
            sanitizerRules?: SanitizerRule[];
        }
    ): TaintFlow[] {
        if (!this.cg) return [];
        const scoped = runSinkDetector(
            this.scene,
            this.cg,
            this.pag,
            this.tracker,
            sinkSignature,
            this.log.bind(this),
            {
                ...options,
                fieldToVarIndex: this.fieldToVarIndex,
                allowedMethodSignatures: this.activeReachableMethodSignatures,
                orderedMethodSignatures: this.activeOrderedMethodSignatures,
                onProfile: (profile) => this.mergeDetectProfile(profile),
            }
        );
        return scoped;
    }

    private resolveSinkSignatureMatchMode(rule: SinkRule): "contains" | "equals" {
        switch (rule.match.kind) {
            case "signature_equals":
            case "declaring_class_equals":
            case "signature_regex":
                return "equals";
            default:
                return "contains";
        }
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
        invokeKind?: RuleInvokeKind;
        argCount?: number;
        typeHint?: string;
    } {
        const norm = rule.target ? normalizeEndpoint(rule.target) : undefined;
        return {
            targetEndpoint: norm?.endpoint,
            targetPath: norm?.path,
            invokeKind: rule.match.invokeKind,
            argCount: rule.match.argCount,
            typeHint: rule.match.typeHint,
        };
    }

    private shouldSuppressSafeOverwriteFlow(flow: TaintFlow): boolean {
        const sinkNodeId = flow.sinkNodeId;
        if (sinkNodeId === undefined || sinkNodeId === null) return false;
        const sinkNode: any = this.pag?.getNode?.(sinkNodeId);
        const sinkValue: any = sinkNode?.getValue?.();
        if (!(sinkValue instanceof Local)) return false;
        const declStmt: any = sinkValue.getDeclaringStmt?.();
        if (!(declStmt instanceof ArkAssignStmt)) return false;
        const right: any = declStmt.getRightOp?.();
        if (!(right instanceof ArkInstanceInvokeExpr)) return false;
        const methodSig = right.getMethodSignature?.();
        const methodName = methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "";
        if (methodName !== "get" && methodName !== "getSync") return false;
        const args = right.getArgs?.() || [];
        if (args.length < 1) return false;
        const keyArg = args[0];
        const keyText = String(keyArg?.toString?.() || "").trim();
        const keyLiteral = this.normalizeQuotedLiteral(keyText);
        if (!keyLiteral) return false;

        const cfg = declStmt.getCfg?.();
        if (!cfg) return false;
        const stmts: any[] = cfg.getStmts?.() || [];
        const idx = stmts.indexOf(declStmt);
        if (idx < 0) return false;

        for (let i = idx - 1; i >= 0; i--) {
            const stmt = stmts[i];
            if (!stmt?.containsInvokeExpr?.()) continue;
            const inv: any = stmt.getInvokeExpr?.();
            if (!(inv instanceof ArkInstanceInvokeExpr)) continue;
            const invName = inv.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || "";
            if (invName !== "put" && invName !== "putSync") continue;
            const invArgs = inv.getArgs?.() || [];
            if (invArgs.length < 2) continue;
            const putKey = this.normalizeQuotedLiteral(String(invArgs[0]?.toString?.() || "").trim());
            if (!putKey || putKey !== keyLiteral) continue;
            const putVal = invArgs[1];
            const putLiteral = this.normalizeQuotedLiteral(String(putVal?.toString?.() || "").trim());
            if (!putLiteral) return false;
            return true;
        }
        return false;
    }

    private shouldSuppressKeyedRouteCallbackMismatchFlow(flow: TaintFlow): boolean {
        const ruleId = flow.sourceRuleId || this.parseSourceRuleId(flow.source) || "";
        if (!ruleId.startsWith("source.auto.callback_param.")) return false;
        const sinkMethodSig = flow.sink?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.() || "";
        const filePath = extractFilePathFromSignature(sinkMethodSig);
        if (!filePath) return false;
        const cached = this.keyedRouteMismatchCache.get(filePath);
        if (cached !== undefined) return cached;
        const result = this.hasKnownNavDestinationRouteMismatchInFile(filePath);
        this.keyedRouteMismatchCache.set(filePath, result);
        return result;
    }

    private hasKnownNavDestinationRouteMismatchInFile(filePath: string): boolean {
        for (const sourceMethod of this.scene.getMethods()) {
            const sourceMethodSig = sourceMethod.getSignature?.()?.toString?.() || "";
            if (extractFilePathFromSignature(sourceMethodSig) !== filePath) continue;
            const dispatchKeys = collectKnownKeyedDispatchKeysFromMethod(this.scene, sourceMethod).get("nav_destination");
            if (!dispatchKeys || dispatchKeys.size === 0) continue;
            const pushRouteKeys = this.collectKnownRoutePushKeysFromMethod(sourceMethod);
            if (pushRouteKeys.size === 0) continue;

            const cfg = sourceMethod.getCfg?.();
            if (!cfg) continue;
            const registrationKeys = new Set<string>();
            for (const stmt of cfg.getStmts()) {
                const registrations = resolveKnownKeyedCallbackRegistrationsFromStmt(stmt, this.scene, sourceMethod);
                for (const reg of registrations) {
                    if (reg.familyId !== "nav_destination") continue;
                    for (const key of reg.dispatchKeys || []) registrationKeys.add(key);
                }
            }
            const effectiveDispatchKeys = this.intersectStringSets(dispatchKeys, registrationKeys);
            if (effectiveDispatchKeys.size === 0) continue;
            if (!this.hasStringSetIntersection(effectiveDispatchKeys, pushRouteKeys)) {
                return true;
            }
        }
        return false;
    }

    private collectKnownRoutePushKeysFromMethod(method: ArkMethod): Set<string> {
        const methodSig = method.getSignature?.()?.toString?.() || "";
        if (!methodSig) return new Set<string>();
        const cached = this.routePushKeyCache.get(methodSig);
        if (cached) return cached;

        const out = new Set<string>();
        const cfg = method.getCfg?.();
        const stmts = cfg?.getStmts?.() || [];
        const knownPushMethods = new Map<string, string>([
            ["pushNamedRoute", "name"],
            ["pushPath", "name"],
            ["pushPathByName", "name"],
            ["replacePath", "name"],
            ["pushUrl", "url"],
            ["replaceUrl", "url"],
        ]);

        const addKeysFromValue = (value: any, routeFieldName: string): void => {
            for (const literal of collectFiniteStringCandidatesFromValue(this.scene, value)) {
                if (literal) out.add(literal);
            }
            if (!(value instanceof Local)) return;
            for (const stmt of stmts) {
                if (!(stmt instanceof ArkAssignStmt)) continue;
                const left = stmt.getLeftOp?.();
                if (!(left instanceof ArkInstanceFieldRef)) continue;
                if (left.getBase?.() !== value) continue;
                const fieldName = left.getFieldSignature?.().getFieldName?.() || left.getFieldName?.() || "";
                if (fieldName !== routeFieldName) continue;
                for (const literal of collectFiniteStringCandidatesFromValue(this.scene, stmt.getRightOp?.())) {
                    if (literal) out.add(literal);
                }
            }
        };

        for (const stmt of stmts) {
            if (!stmt?.containsInvokeExpr?.()) continue;
            const invokeExpr = stmt.getInvokeExpr?.();
            if (!(invokeExpr instanceof ArkStaticInvokeExpr || invokeExpr instanceof ArkInstanceInvokeExpr)) continue;
            const methodName = invokeExpr.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || "";
            const routeFieldName = knownPushMethods.get(methodName);
            if (!routeFieldName) continue;
            const invokeArgs = invokeExpr.getArgs?.() || [];
            for (const arg of invokeArgs) {
                addKeysFromValue(arg, routeFieldName);
            }
        }

        this.routePushKeyCache.set(methodSig, out);
        return out;
    }

    private intersectStringSets(left: Set<string>, right: Set<string>): Set<string> {
        const out = new Set<string>();
        for (const value of left) {
            if (right.has(value)) out.add(value);
        }
        return out;
    }

    private hasStringSetIntersection(left: Set<string>, right: Set<string>): boolean {
        for (const value of left) {
            if (right.has(value)) return true;
        }
        return false;
    }

    private normalizeQuotedLiteral(text: string): string | undefined {
        const m = String(text || "").match(/^['"`]((?:\\.|[^'"`])+)['"`]$/);
        if (!m) return undefined;
        return m[1];
    }

    public getAdaptiveContextSelector(): AdaptiveContextSelector | undefined {
        return this.adaptiveContextSelector;
    }

    public getWorklistProfile(): WorklistProfileSnapshot | undefined {
        if (!this.worklistProfiler) return undefined;
        return this.worklistProfiler.snapshot();
    }

    public getPropagationTraceDot(graphName: string = "arktaint_propagation"): string | undefined {
        if (!this.propagationTrace) return undefined;
        return this.propagationTrace.toDot(graphName);
    }

    public dumpDebugArtifacts(tag: string, outputDir: string = "tmp"): { profilePath?: string; dotPath?: string } {
        const safeTag = tag.replace(/[^A-Za-z0-9_.-]/g, "_");
        const profile = this.getWorklistProfile();
        const dot = this.getPropagationTraceDot(`propagation_${safeTag}`);
        return dumpDebugArtifactsToDir({ tag: safeTag, outputDir, profile, dot });
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
        this.propagationTrace = collectors.propagationTrace;
    }

    private resolveExplicitEntryScope(seedMethods: ArkMethod[]): Set<string> | undefined {
        if (seedMethods.length === 0) return undefined;
        const expandedMethods = expandEntryMethodsByDirectCalls(this.scene, seedMethods);
        const signatures = new Set<string>();
        for (const method of expandedMethods) {
            const signature = method.getSignature?.()?.toString?.();
            if (!signature) continue;
            signatures.add(signature);
        }
        return signatures.size > 0 ? signatures : undefined;
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

function extractFilePathFromSignature(signature: string): string {
    const at = signature.indexOf("@");
    if (at < 0) return "";
    const methodSep = signature.indexOf(": ", at);
    if (methodSep < 0) return "";
    return signature.slice(at + 1, methodSep).replace(/\\/g, "/");
}

