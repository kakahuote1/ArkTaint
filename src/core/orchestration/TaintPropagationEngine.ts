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
import { TaintFact } from "../kernel/TaintFact";
import { TaintFlow } from "../kernel/TaintFlow";
import { TaintTracker } from "../kernel/TaintTracker";
import { TaintContextManager, CallEdgeInfo, CallEdgeType } from "../kernel/context/TaintContext";
import { AdaptiveContextSelector, AdaptiveContextSelectorOptions } from "../kernel/context/AdaptiveContextSelector";
import { buildFieldToVarIndex } from "../kernel/FieldIndexBuilder";
import {
    buildCallEdgeMap,
    buildCaptureEdgeMap,
    buildCaptureLazyMaterializer,
    CaptureEdgeInfo,
    CaptureLazyMaterializer,
    materializeCaptureSitesForNode
} from "../kernel/CallEdgeMapBuilder";
import {
    buildSyntheticInvokeEdges,
    buildSyntheticInvokeLazyMaterializer,
    buildSyntheticConstructorStoreMap,
    buildSyntheticFieldBridgeMap,
    materializeEagerSyntheticInvokeSites,
    materializeSyntheticInvokeSitesForNode,
    materializeAllSyntheticInvokeSites,
    SyntheticInvokeEdgeInfo,
    SyntheticConstructorStoreInfo,
    SyntheticFieldBridgeInfo,
    SyntheticInvokeLazyMaterializer
} from "../kernel/SyntheticInvokeEdgeBuilder";
import { FactRuleChain, WorklistSolver, WorklistSolverDeps } from "../kernel/WorklistSolver";
import {
    createEmptySinkDetectProfile,
    detectSinks as runSinkDetector,
    mergeSinkDetectProfiles,
    SinkDetectProfile,
} from "../kernel/SinkDetector";
import { collectSourceRuleSeeds as collectSourceRuleSeedsFromRules } from "../kernel/SourceRuleSeedCollector";
import { resolveSinkRuleSignatures as resolveSinkRuleSignaturesByRule } from "../kernel/SinkRuleSignatureResolver";
import { createDebugCollectors, dumpDebugArtifactsToDir } from "../kernel/DebugArtifactUtils";
import { WorklistProfiler, WorklistProfileSnapshot } from "../kernel/WorklistProfiler";
import { PropagationTrace } from "../kernel/PropagationTrace";
import { expandEntryMethodsByDirectCalls } from "../entry/shared/ExplicitEntryScopeResolver";
import {
    collectKnownKeyedDispatchKeysFromMethod,
    resolveKnownKeyedCallbackRegistrationsFromStmt,
} from "../entry/shared/FrameworkCallbackClassifier";
import {
    HARMONY_LIFECYCLE_SOURCE_RULES,
} from "../../rules/HarmonyLifecycleSourceRules";
import {
    collectParameterAssignStmts,
    resolveMethodsFromCallable,
} from "../substrate/queries/CalleeResolver";
import { collectFiniteStringCandidatesFromValue } from "../substrate/queries/FiniteStringCandidateResolver";
import { buildArkMainPlan } from "../entry/arkmain/ArkMainPlanner";
import { ArkMainSyntheticRootBuilder } from "../entry/arkmain/ArkMainSyntheticRootBuilder";
import { SemanticPack } from "../kernel/contracts/SemanticPack";
import { loadSemanticPacks } from "./packs/PackLoader";
import { createSemanticPackRuntime } from "./packs/PackRuntime";
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

export interface DebugOptions {
    enableWorklistProfile?: boolean;
    enablePropagationTrace?: boolean;
    propagationTraceMaxEdges?: number;
}

export interface TaintEngineOptions {
    contextStrategy?: "fixed" | "adaptive";
    adaptiveContext?: AdaptiveContextSelectorOptions;
    transferRules?: TransferRule[];
    semanticPacks?: SemanticPack[];
    semanticPackDirs?: string[];
    semanticPackFiles?: string[];
    includeBuiltinSemanticPacks?: boolean;
    disabledSemanticPackIds?: string[];
    enginePlugins?: EnginePlugin[];
    enginePluginDirs?: string[];
    enginePluginFiles?: string[];
    disabledEnginePluginNames?: string[];
    pluginDryRun?: boolean;
    pluginIsolate?: string[];
    pluginAudit?: boolean;
    enableHarmonyAppStorageModeling?: boolean;
    enableHarmonyStateModeling?: boolean;
    enableHarmonyRouterModeling?: boolean;
    enableHarmonyAbilityHandoffModeling?: boolean;
    debug?: DebugOptions;
}

export interface BuildPAGOptions {
    syntheticEntryMethods?: ArkMethod[];
    entryModel?: "arkMain";
}

type EntryModel = "arkMain";

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
    captureEdgeMap: Map<number, CaptureEdgeInfo[]>;
    syntheticInvokeEdgeMap: Map<number, SyntheticInvokeEdgeInfo[]>;
    syntheticConstructorStoreMap: Map<number, SyntheticConstructorStoreInfo[]>;
    syntheticFieldBridgeMap: Map<string, SyntheticFieldBridgeInfo[]>;
    captureLazyMaterializer?: CaptureLazyMaterializer;
    syntheticInvokeLazyMaterializer?: SyntheticInvokeLazyMaterializer;
    captureEdgeMapReady: boolean;
    syntheticInvokeEdgeMapReady: boolean;
}

export class TaintPropagationEngine {
    private static sceneIdSeed: number = 1;
    private static sceneIds: WeakMap<Scene, number> = new WeakMap();
    private static pagBuildCache: Map<string, PagBuildCacheEntry> = new Map();

    private scene: Scene;
    public pag!: Pag; // Public for test seeding.
    public cg!: CallGraph;
    private tracker: TaintTracker;
    private pta!: PointerAnalysis;

    private fieldToVarIndex: Map<string, Set<number>> = new Map();
    private ctxManager: TaintContextManager;
    private callEdgeMap: Map<string, CallEdgeInfo> = new Map();
    private captureEdgeMap: Map<number, CaptureEdgeInfo[]> = new Map();
    private syntheticInvokeEdgeMap: Map<number, SyntheticInvokeEdgeInfo[]> = new Map();
    private syntheticConstructorStoreMap: Map<number, SyntheticConstructorStoreInfo[]> = new Map();
    private syntheticFieldBridgeMap: Map<string, SyntheticFieldBridgeInfo[]> = new Map();
    private captureLazyMaterializer?: CaptureLazyMaterializer;
    private syntheticInvokeLazyMaterializer?: SyntheticInvokeLazyMaterializer;
    private adaptiveContextSelector?: AdaptiveContextSelector;
    private worklistProfiler?: WorklistProfiler;
    private propagationTrace?: PropagationTrace;
    private options: TaintEngineOptions;
    private semanticPacks: SemanticPack[];
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
    private explicitEntryScopeMethodSignatures?: Set<string>;
    private autoSourceHintRules: SourceRule[] = [];
    private detectProfile: SinkDetectProfile = createEmptySinkDetectProfile();
    private keyedRouteMismatchCache: Map<string, boolean> = new Map();
    private routePushKeyCache: Map<string, Set<string>> = new Map();
    private activePagCacheEntry?: PagBuildCacheEntry;

    public verbose: boolean = true;

    constructor(scene: Scene, k: number = 1, options: TaintEngineOptions = {}) {
        this.scene = scene;
        this.tracker = new TaintTracker();
        this.ctxManager = new TaintContextManager(k);
        this.options = options;
        this.semanticPacks = this.initializeSemanticPacks(options);
        const enginePluginState = this.initializeEnginePlugins(k, options, this.semanticPacks);
        this.enginePlugins = enginePluginState.plugins;
        this.enginePluginWarnings = enginePluginState.warnings;
        this.enginePluginRuntime = enginePluginState.runtime;
        const verboseOverride = this.enginePluginRuntime.getOptionOverrides().get("verbose");
        if (typeof verboseOverride === "boolean") {
            this.verbose = verboseOverride;
        }
    }

    private initializeSemanticPacks(options: TaintEngineOptions): SemanticPack[] {
        const loadedPacks = loadSemanticPacks({
            includeBuiltinPacks: options.includeBuiltinSemanticPacks,
            disabledPackIds: this.resolveDisabledSemanticPackIds(options),
            packDirs: options.semanticPackDirs,
            packFiles: options.semanticPackFiles,
            packs: options.semanticPacks,
            onWarning: (warning) => this.log(`[Phase8] ${warning}`),
        });
        return loadedPacks.packs;
    }

    private initializeEnginePlugins(
        k: number,
        options: TaintEngineOptions,
        semanticPacks: SemanticPack[],
    ): {
        plugins: EnginePlugin[];
        warnings: string[];
        runtime: EnginePluginRuntime;
    } {
        const loadedPlugins = loadEnginePlugins({
            pluginDirs: options.enginePluginDirs,
            pluginFiles: options.enginePluginFiles,
            plugins: options.enginePlugins,
            disabledPluginNames: options.disabledEnginePluginNames,
            isolatePluginNames: options.pluginIsolate,
            onWarning: (warning) => this.log(`[Phase8.5] ${warning}`),
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
                    semanticPackIds: semanticPacks.map(pack => pack.id),
                },
                dryRun: options.pluginDryRun === true,
            }),
        };
    }

    private resolveDisabledSemanticPackIds(options: TaintEngineOptions): string[] {
        const disabled = new Set<string>(options.disabledSemanticPackIds || []);
        if (options.enableHarmonyAppStorageModeling === false) disabled.add("harmony.appstorage");
        if (options.enableHarmonyStateModeling === false) disabled.add("harmony.state");
        if (options.enableHarmonyRouterModeling === false) disabled.add("harmony.router");
        if (options.enableHarmonyAbilityHandoffModeling === false) disabled.add("harmony.ability_handoff");
        return [...disabled.values()];
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

    private parseSourceRuleId(source: string): string | undefined {
        if (!source.startsWith("source_rule:")) return undefined;
        const id = source.slice("source_rule:".length).trim();
        return id.length > 0 ? id : undefined;
    }

    private resolveRuleFamily(rule: BaseRule): string | undefined {
        const family = typeof rule.family === "string" ? rule.family.trim() : "";
        return family.length > 0 ? family : undefined;
    }

    private resolveRuleTierWeight(rule: BaseRule): number {
        if (rule.tier === "A") return 3;
        if (rule.tier === "B") return 2;
        if (rule.tier === "C") return 1;
        return 0;
    }

    private orderRulesByFamilyTier<T extends BaseRule>(rules: T[]): T[] {
        return [...rules].sort((a, b) => {
            const fa = this.resolveRuleFamily(a) || a.id;
            const fb = this.resolveRuleFamily(b) || b.id;
            if (fa !== fb) return fa.localeCompare(fb);
            const ta = this.resolveRuleTierWeight(a);
            const tb = this.resolveRuleTierWeight(b);
            if (ta !== tb) return tb - ta;
            return a.id.localeCompare(b.id);
        });
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
        this.clearRuleHits();
        this.clearFactRuleChains();

        const sceneId = this.getOrCreateSceneId();
        const entryModel: EntryModel = options.entryModel || "arkMain";
        const explicitSyntheticEntries = this.normalizeSyntheticEntryMethods(options.syntheticEntryMethods);
        this.explicitEntryScopeMethodSignatures = this.resolveExplicitEntryScope(explicitSyntheticEntries);
        const arkMainPlan = buildArkMainPlan(this.scene, { seedMethods: explicitSyntheticEntries });
        this.autoSourceHintRules = this.buildAutoSourceHintRules(arkMainPlan);
        if (arkMainPlan?.schedule.convergence.truncated) {
            for (const warning of arkMainPlan.schedule.warnings) {
                this.log(`[ArkMain] WARNING: ${warning}`);
            }
        }
        const syntheticEntryMethods = this.resolveSyntheticEntryMethods(
            explicitSyntheticEntries,
            entryModel,
            arkMainPlan,
        );
        const syntheticKey = syntheticEntryMethods.length > 0
            ? `synthetic|${syntheticEntryMethods.map(method => method.getSignature().toString()).join("||")}`
            : "pure";
        const cacheKey = `${sceneId}|entryModel|${entryModel}|${syntheticKey}`;
        const cached = TaintPropagationEngine.pagBuildCache.get(cacheKey);
        if (cached) {
            this.activePagCacheEntry = cached;
            this.pag = cached.pag;
            this.cg = cached.cg;
            this.fieldToVarIndex = cached.fieldToVarIndex;
            this.callEdgeMap = cached.callEdgeMap;
            this.captureEdgeMap = cached.captureEdgeMap;
            this.syntheticInvokeEdgeMap = cached.syntheticInvokeEdgeMap;
            this.syntheticConstructorStoreMap = cached.syntheticConstructorStoreMap;
            this.syntheticFieldBridgeMap = cached.syntheticFieldBridgeMap;
            this.captureLazyMaterializer = cached.captureLazyMaterializer;
            this.syntheticInvokeLazyMaterializer = cached.syntheticInvokeLazyMaterializer;
            this.log(`PAG cache hit: ${entryModel}(${syntheticKey})`);
            this.log(`PAG nodes: ${this.pag.getNodeNum()}, edges: ${this.pag.getEdgeNum()}`);
            this.log(`CG nodes: ${this.cg.getNodeNum()}, edges: ${this.cg.getEdgeNum()}`);
            this.configureContextStrategy();
            return;
        }

        const cg = new CallGraph(this.scene);
        const cgBuilder = new CallGraphBuilder(cg, this.scene);
        cgBuilder.buildDirectCallGraphForScene();
        const pag = new Pag();
        const config = PointerAnalysisConfig.create(0, "./out", false, false, false);
        this.pta = new PointerAnalysis(pag, cg, this.scene, config);
        const { syntheticRootMethod, cleanup } = this.createSyntheticEntry(syntheticEntryMethods);
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
        this.captureEdgeMap = new Map<number, CaptureEdgeInfo[]>();
        this.syntheticInvokeEdgeMap = new Map<number, SyntheticInvokeEdgeInfo[]>();
        this.captureLazyMaterializer = buildCaptureLazyMaterializer(this.scene, this.cg, this.pag);
        this.syntheticInvokeLazyMaterializer = buildSyntheticInvokeLazyMaterializer(this.scene, this.cg, this.pag, this.log.bind(this));
        this.syntheticConstructorStoreMap = buildSyntheticConstructorStoreMap(this.scene, this.cg, this.pag, this.log.bind(this));
        this.syntheticFieldBridgeMap = buildSyntheticFieldBridgeMap(this.scene, this.cg, this.pag, this.log.bind(this));
        const cacheEntry: PagBuildCacheEntry = {
            pag: this.pag,
            cg: this.cg,
            fieldToVarIndex: this.fieldToVarIndex,
            callEdgeMap: this.callEdgeMap,
            captureEdgeMap: this.captureEdgeMap,
            syntheticInvokeEdgeMap: this.syntheticInvokeEdgeMap,
            syntheticConstructorStoreMap: this.syntheticConstructorStoreMap,
            syntheticFieldBridgeMap: this.syntheticFieldBridgeMap,
            captureLazyMaterializer: this.captureLazyMaterializer,
            syntheticInvokeLazyMaterializer: this.syntheticInvokeLazyMaterializer,
            captureEdgeMapReady: false,
            syntheticInvokeEdgeMapReady: false,
        };
        this.activePagCacheEntry = cacheEntry;
        TaintPropagationEngine.pagBuildCache.set(cacheKey, cacheEntry);
        this.configureContextStrategy();
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

    private createSyntheticEntry(entryMethods: ArkMethod[] = []): {
        syntheticRootMethod: any;
        cleanup: () => void;
    } {
        return this.createArkMainSyntheticEntry(entryMethods);
    }

    private createArkMainSyntheticEntry(entryMethods: ArkMethod[] = []): {
        syntheticRootMethod: any;
        cleanup: () => void;
    } {
        const root = SYNTHETIC_ROOTS.arkMain;
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

    public setActiveReachableMethodSignatures(methodSignatures?: Set<string>): void {
        const merged = new Set<string>();
        if (methodSignatures) {
            for (const signature of methodSignatures) {
                merged.add(signature);
            }
        }
        if (this.explicitEntryScopeMethodSignatures) {
            for (const signature of this.explicitEntryScopeMethodSignatures) {
                merged.add(signature);
            }
        }
        if (merged.size === 0) {
            this.activeReachableMethodSignatures = undefined;
            return;
        }
        this.activeReachableMethodSignatures = merged;
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

        while (queue.length > 0) {
            const nodeId = queue.shift()!;
            if (visited.has(nodeId)) continue;
            visited.add(nodeId);

            const methodSig = this.cg.getMethodByFuncID(nodeId);
            if (methodSig) {
                reachable.add(methodSig.toString());
            }

            const node = this.cg.getNode(nodeId);
            if (!node) continue;
            for (const edge of node.getOutgoingEdges()) {
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
        while (syntheticQueue.length > 0) {
            const sig = syntheticQueue.shift()!;
            const callees = syntheticAdj.get(sig);
            if (!callees) continue;
            for (const callee of callees) {
                if (syntheticVisited.has(callee)) continue;
                syntheticVisited.add(callee);
                reachable.add(callee);
                syntheticQueue.push(callee);
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
        this.observedFacts.clear();
        this.lastEnginePluginFindings = [];
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
        const pluginSourceRules = this.enginePluginRuntime.getAdditionalSourceRules();
        const effectiveSourceRules = this.mergeBuiltinSourceRules(
            this.mergeAutoSourceHintRules([...(sourceRules || []), ...pluginSourceRules])
        );
        let ruleSeeds = this.collectSourceRuleSeeds(effectiveSourceRules, this.activeReachableMethodSignatures);
        if (
            ruleSeeds.facts.length === 0
            && this.activeReachableMethodSignatures
            && this.activeReachableMethodSignatures.size > 0
        ) {
            // Fallback: when reachable-gated seeding produces nothing (common in
            // callback/watch-only benchmark cases), retry once on full method scope.
            const ungatedSeeds = this.collectSourceRuleSeeds(effectiveSourceRules);
            if (ungatedSeeds.facts.length > 0) {
                this.log(`[SourceSeeds] reachable-gated seeds=0; fallback ungated seeds=${ungatedSeeds.facts.length}`);
                ruleSeeds = ungatedSeeds;
                const recoveredReachable = this.recoverMethodSignaturesFromSeedFacts(ungatedSeeds.facts);
                if (recoveredReachable.size > 0) {
                    const merged = new Set<string>(this.activeReachableMethodSignatures);
                    for (const sig of recoveredReachable) {
                        merged.add(sig);
                    }
                    this.activeReachableMethodSignatures = merged;
                }
            }
        }
        if (ruleSeeds.activatedMethodSignatures.length > 0) {
            const mergedReachable = new Set<string>(this.activeReachableMethodSignatures || []);
            for (const sig of ruleSeeds.activatedMethodSignatures) {
                mergedReachable.add(sig);
            }
            // NOTE: flow-insensitive propagation does not model event-loop ordering.
            // We expand reachable methods to activate callback bodies discovered at registration sites.
            this.activeReachableMethodSignatures = mergedReachable;
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
        this.propagateWithFacts(Array.from(mergedFacts.values()));
        return {
            seedCount: mergedFacts.size,
            seededLocals: [...seededLocals].sort(),
            sourceRuleHits: this.toRecord(this.ruleHits.source),
        };
    }

    public getAutoSourceHintRules(): SourceRule[] {
        return this.autoSourceHintRules.map(rule => {
            const ref = normalizeEndpoint(rule.target);
            const target: RuleEndpointOrRef =
                ref.path === undefined && ref.pathFrom === undefined && ref.slotKind === undefined
                    ? ref.endpoint
                    : { ...ref };
            return {
                ...rule,
                tags: rule.tags ? [...rule.tags] : undefined,
                scope: rule.scope ? { ...rule.scope } : undefined,
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
        const effectiveSinkRules = [
            ...(sinkRules || []),
            ...this.enginePluginRuntime.getAdditionalSinkRules(),
        ];
        const effectiveSanitizerRules = [
            ...(options?.sanitizerRules || []),
            ...this.enginePluginRuntime.getAdditionalSanitizerRules(),
        ];
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
        const matchedSiteFamily = new Set<string>();
        for (const rule of orderedSinkRules) {
            if (reachedFlowLimit()) break;
            const signatures = resolveSinkRuleSignaturesByRule(this.scene, rule);
            const target = this.resolveSinkRuleTarget(rule);
            const signatureMatchMode = this.resolveSinkSignatureMatchMode(rule);
            const sinkEndpoint = target.targetEndpoint || "any_arg";
            const sinkPathSuffix = target.targetPath && target.targetPath.length > 0
                ? `.${target.targetPath.join(".")}`
                : "";
            const family = this.resolveRuleFamily(rule);
            for (const signature of signatures) {
                const cacheKey = buildDetectCacheKey(signature, target, signatureMatchMode);
                const familySiteKey = family ? `${cacheKey}|${family}` : "";
                if (familySiteKey && matchedSiteFamily.has(familySiteKey)) {
                    continue;
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
                    !this.shouldSuppressWatchLikeMismatchFlow(flow)
                    && !this.shouldSuppressSafeOverwriteFlow(flow)
                    && !this.shouldSuppressKeyedRouteCallbackMismatchFlow(flow)
                );
                const beforeSize = flowMap.size;
                addFlows(rule.id, flows);
                if (familySiteKey && flowMap.size > beforeSize) {
                    matchedSiteFamily.add(familySiteKey);
                }
                if (reachedFlowLimit()) break;
            }
        }

        return Array.from(flowMap.values());
    }

    private runWorkList(worklist: TaintFact[], visited: Set<string>): void {
        this.prepareDebugCollectors();
        const orderedTransferRules = this.orderRulesByFamilyTier([
            ...(this.options.transferRules || []),
            ...this.enginePluginRuntime.getAdditionalTransferRules(),
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
        const semanticPackQueries = {
            resolveMethodsFromCallable,
            collectParameterAssignStmts,
            collectFiniteStringCandidatesFromValue,
        };
        const semanticPackRuntime = createSemanticPackRuntime(this.semanticPacks, {
            scene: this.scene,
            pag: this.pag,
            allowedMethodSignatures: this.activeReachableMethodSignatures,
            fieldToVarIndex: this.fieldToVarIndex,
            queries: semanticPackQueries,
            log: this.log.bind(this),
        });
        return {
            scene: this.scene,
            pag: this.pag,
            tracker: this.tracker,
            ctxManager: this.ctxManager,
            callEdgeMap: this.callEdgeMap,
            captureEdgeMap: this.captureEdgeMap,
            syntheticInvokeEdgeMap: this.syntheticInvokeEdgeMap,
            syntheticConstructorStoreMap: this.syntheticConstructorStoreMap,
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
            semanticPackRuntime,
            semanticPackQueries,
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
            loadedSemanticPackIds: this.semanticPacks.map(pack => pack.id),
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
        if (!cacheEntry) {
            return this.syntheticInvokeEdgeMap.get(nodeId);
        }
        if (cacheEntry.syntheticInvokeLazyMaterializer) {
            materializeEagerSyntheticInvokeSites(
                this.scene,
                this.cg,
                this.pag,
                this.syntheticInvokeEdgeMap,
                cacheEntry.syntheticInvokeLazyMaterializer
            );
            materializeSyntheticInvokeSitesForNode(
                this.scene,
                this.cg,
                this.pag,
                this.syntheticInvokeEdgeMap,
                cacheEntry.syntheticInvokeLazyMaterializer,
                nodeId
            );
            return this.syntheticInvokeEdgeMap.get(nodeId);
        }
        if (!cacheEntry.syntheticInvokeEdgeMapReady) {
            this.log("[LazyEdges] materializing syntheticInvokeEdgeMap on first demand");
            cacheEntry.syntheticInvokeEdgeMap = buildSyntheticInvokeEdges(this.scene, this.cg, this.pag, this.log.bind(this));
            cacheEntry.syntheticInvokeEdgeMapReady = true;
            this.syntheticInvokeEdgeMap = cacheEntry.syntheticInvokeEdgeMap;
        }
        return this.syntheticInvokeEdgeMap.get(nodeId);
    }

    private ensureAllSyntheticInvokeEdgesMaterialized(): void {
        const cacheEntry = this.activePagCacheEntry;
        if (!cacheEntry) return;
        if (cacheEntry.syntheticInvokeLazyMaterializer) {
            materializeAllSyntheticInvokeSites(
                this.scene,
                this.cg,
                this.pag,
                this.syntheticInvokeEdgeMap,
                cacheEntry.syntheticInvokeLazyMaterializer
            );
            return;
        }
        if (!cacheEntry.syntheticInvokeEdgeMapReady) {
            cacheEntry.syntheticInvokeEdgeMap = buildSyntheticInvokeEdges(this.scene, this.cg, this.pag, this.log.bind(this));
            cacheEntry.syntheticInvokeEdgeMapReady = true;
            this.syntheticInvokeEdgeMap = cacheEntry.syntheticInvokeEdgeMap;
        }
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

    private mergeAutoSourceHintRules(sourceRules: SourceRule[]): SourceRule[] {
        if (this.autoSourceHintRules.length === 0) {
            return sourceRules;
        }
        // Auto callback-param hints are an ArkMain fallback for source-sparse analyses.
        // When the caller already provides explicit source rules, keep the analysis
        // rule-driven and avoid mixing entry-model heuristics into propagation benchmarks.
        if ((sourceRules || []).length > 0) {
            return sourceRules;
        }
        const merged = new Map<string, SourceRule>();
        for (const rule of [...sourceRules, ...this.autoSourceHintRules]) {
            if (!rule?.id) continue;
            if (!merged.has(rule.id)) {
                merged.set(rule.id, rule);
            }
        }
        return [...merged.values()];
    }

    private mergeBuiltinSourceRules(sourceRules: SourceRule[]): SourceRule[] {
        const merged = new Map<string, SourceRule>();
        for (const rule of [...sourceRules, ...HARMONY_LIFECYCLE_SOURCE_RULES]) {
            if (!rule?.id) continue;
            if (!merged.has(rule.id)) {
                merged.set(rule.id, rule);
            }
        }
        return [...merged.values()];
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

    private buildAutoSourceHintRules(
        arkMainPlan?: ReturnType<typeof buildArkMainPlan>,
    ): SourceRule[] {
        if (!arkMainPlan) {
            return [];
        }

        const out = new Map<string, SourceRule>();
        for (const fact of arkMainPlan.facts) {
            if (fact.kind !== "callback") continue;
            if (
                fact.entryFamily !== "unknown_sdk_callback"
                && fact.entryFamily !== "unknown_external_callback"
                && fact.entryFamily !== "unknown_structural_callback"
            ) {
                continue;
            }
            // Known callback slot families (including keyed dispatch like NavDestination.register/trigger)
            // should be modeled by their own framework semantics rather than promoted to open-world
            // auto callback-param sources.
            if (fact.callbackSlotFamily) {
                continue;
            }
            if (!fact.callbackRegistrationSignature || fact.callbackArgIndex === undefined) {
                continue;
            }
            const callbackRegSig = String(fact.callbackRegistrationSignature || "");
            if (
                callbackRegSig.includes("NavDestination.register")
                || callbackRegSig.includes("NavDestination.setBuilder")
                || callbackRegSig.includes("NavDestination.setDestinationBuilder")
            ) {
                continue;
            }

            const parameterCount = fact.method.getParameters?.().length || 0;
            for (let paramIndex = 0; paramIndex < parameterCount; paramIndex++) {
                const dedupeKey = `${fact.callbackRegistrationSignature}|cbArg:${fact.callbackArgIndex}|param:${paramIndex}`;
                if (out.has(dedupeKey)) continue;
                out.set(dedupeKey, {
                    id: `source.auto.callback_param.${out.size}`,
                    sourceKind: "callback_param",
                    family: "arkmain_unknown_callback_hint",
                    tier: "C",
                    description: `[auto hint] ${fact.entryFamily} callback param arg${paramIndex}`,
                    tags: ["auto", "source-hint", "callback_param", fact.entryFamily],
                    match: {
                        kind: "signature_equals",
                        value: fact.callbackRegistrationSignature,
                    },
                    target: `arg${paramIndex}`,
                    callbackArgIndexes: [fact.callbackArgIndex],
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
                onProfile: (profile) => this.mergeDetectProfile(profile),
            }
        );
        if (
            scoped.length === 0
            && this.activeReachableMethodSignatures
            && this.activeReachableMethodSignatures.size > 0
        ) {
            const ungated = runSinkDetector(
                this.scene,
                this.cg,
                this.pag,
                this.tracker,
                sinkSignature,
                this.log.bind(this),
                {
                    ...options,
                    fieldToVarIndex: this.fieldToVarIndex,
                    allowedMethodSignatures: undefined,
                    onProfile: (profile) => this.mergeDetectProfile(profile),
                }
            );
            if (ungated.length > 0) {
                return ungated;
            }
        }
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

    private shouldSuppressWatchLikeMismatchFlow(flow: TaintFlow): boolean {
        const sinkStmt: any = flow.sink;
        const sinkMethod = sinkStmt?.getCfg?.()?.getDeclaringMethod?.();
        if (!sinkMethod) return false;
        const watchTarget = this.extractWatchLikeTargetField(sinkMethod.getDecorators?.() || []);
        if (!watchTarget) return false;

        if (flow.sinkNodeId === undefined || flow.sinkNodeId === null) return false;
        const sinkNode: any = this.pag?.getNode?.(flow.sinkNodeId);
        const sinkValue: any = sinkNode?.getValue?.();
        if (!sinkValue) return false;

        const declStmt: any = sinkValue.getDeclaringStmt?.();
        if (!(declStmt instanceof ArkAssignStmt)) return false;
        const right = declStmt.getRightOp?.();
        if (!(right instanceof ArkInstanceFieldRef)) return false;
        const base = right.getBase?.();
        if (!(base instanceof Local) || base.getName?.() !== "this") return false;
        const fieldName = right.getFieldSignature?.().getFieldName?.() || right.getFieldName?.();
        if (!fieldName) return false;
        return fieldName !== watchTarget;
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

    private extractWatchLikeTargetField(decorators: any[]): string | undefined {
        for (const decorator of decorators) {
            const kind = String(decorator?.getKind?.() || "").replace(/^@+/, "").trim();
            if (kind !== "Watch" && kind !== "Monitor") continue;
            const fromParam = this.normalizeDecoratorFieldToken(decorator?.getParam?.());
            if (fromParam) return fromParam;
            const fromContent = this.extractDecoratorFieldTokenFromContent(decorator?.getContent?.());
            if (fromContent) return fromContent;
            return undefined;
        }
        return undefined;
    }

    private normalizeDecoratorFieldToken(raw: any): string | undefined {
        if (raw === undefined || raw === null) return undefined;
        const text = String(raw).trim();
        if (!text) return undefined;
        return text.replace(/^['"`]/, "").replace(/['"`]$/, "").trim() || undefined;
    }

    private normalizeQuotedLiteral(text: string): string | undefined {
        const m = String(text || "").match(/^['"`]((?:\\.|[^'"`])+)['"`]$/);
        if (!m) return undefined;
        return m[1];
    }

    private extractDecoratorFieldTokenFromContent(content: any): string | undefined {
        const text = String(content || "");
        if (!text) return undefined;
        const m = text.match(/\(\s*['"`]([^'"`]+)['"`]\s*\)/);
        if (!m) return undefined;
        return this.normalizeDecoratorFieldToken(m[1]);
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

    private getOrCreateSceneId(): number {
        let sceneId = TaintPropagationEngine.sceneIds.get(this.scene);
        if (!sceneId) {
            sceneId = TaintPropagationEngine.sceneIdSeed++;
            TaintPropagationEngine.sceneIds.set(this.scene, sceneId);
        }
        return sceneId;
    }

}

function extractFilePathFromSignature(signature: string): string {
    const at = signature.indexOf("@");
    if (at < 0) return "";
    const methodSep = signature.indexOf(": ", at);
    if (methodSep < 0) return "";
    return signature.slice(at + 1, methodSep).replace(/\\/g, "/");
}

