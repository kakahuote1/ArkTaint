import { Scene } from "../../arkanalyzer/out/src/Scene";
import { PointerAnalysis } from "../../arkanalyzer/out/src/callgraph/pointerAnalysis/PointerAnalysis";
import { PointerAnalysisConfig } from "../../arkanalyzer/out/src/callgraph/pointerAnalysis/PointerAnalysisConfig";
import { Pag, PagNode } from "../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { CallGraph } from "../../arkanalyzer/out/src/callgraph/model/CallGraph";
import { CallGraphBuilder } from "../../arkanalyzer/out/src/callgraph/model/builder/CallGraphBuilder";
import { DummyMainCreater } from "../../arkanalyzer/out/src/core/common/DummyMainCreater";
import { ArkAssignStmt } from "../../arkanalyzer/out/src/core/base/Stmt";
import { ArkMethod } from "../../arkanalyzer/out/src/core/model/ArkMethod";
import { TaintFact } from "./TaintFact";
import { TaintFlow } from "./TaintFlow";
import { TaintTracker } from "./TaintTracker";
import { TaintContextManager, CallEdgeInfo } from "./context/TaintContext";
import { AdaptiveContextSelector, AdaptiveContextSelectorOptions } from "./context/AdaptiveContextSelector";
import { buildFieldToVarIndex } from "./engine/FieldIndexBuilder";
import { buildCallEdgeMap, buildCaptureEdgeMap, CaptureEdgeInfo } from "./engine/CallEdgeMapBuilder";
import {
    buildSyntheticInvokeEdges,
    buildSyntheticConstructorStoreMap,
    buildSyntheticFieldBridgeMap,
    SyntheticInvokeEdgeInfo,
    SyntheticConstructorStoreInfo,
    SyntheticFieldBridgeInfo
} from "./engine/SyntheticInvokeEdgeBuilder";
import { FactRuleChain, WorklistSolver } from "./engine/WorklistSolver";
import {
    createEmptySinkDetectProfile,
    detectSinks as runSinkDetector,
    mergeSinkDetectProfiles,
    SinkDetectProfile,
} from "./engine/SinkDetector";
import { collectSourceRuleSeeds as collectSourceRuleSeedsFromRules } from "./engine/SourceRuleSeedCollector";
import { resolveSinkRuleSignatures as resolveSinkRuleSignaturesByRule } from "./engine/SinkRuleSignatureResolver";
import { createDebugCollectors, dumpDebugArtifactsToDir } from "./engine/DebugArtifactUtils";
import { WorklistProfiler, WorklistProfileSnapshot } from "./engine/WorklistProfiler";
import { PropagationTrace } from "./engine/PropagationTrace";
import {
    collectHarmonyLifecycleSeeds,
    HarmonyLifecycleSeedCollectionResult,
} from "./harmony/HarmonyLifecycleModeling";
import {
    BaseRule,
    RuleEndpoint,
    RuleInvokeKind,
    SanitizerRule,
    SinkRule,
    SourceRule,
    TransferRule
} from "./rules/RuleSchema";

export interface DebugOptions {
    enableWorklistProfile?: boolean;
    enablePropagationTrace?: boolean;
    propagationTraceMaxEdges?: number;
}

export interface TaintEngineOptions {
    contextStrategy?: "fixed" | "adaptive";
    adaptiveContext?: AdaptiveContextSelectorOptions;
    transferRules?: TransferRule[];
    enableHarmonyAppStorageModeling?: boolean;
    enableHarmonyStateModeling?: boolean;
    debug?: DebugOptions;
}

export interface BuildPAGOptions {
    syntheticEntryMethods?: ArkMethod[];
}

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

export class TaintPropagationEngine {
    private static sceneIdSeed: number = 1;
    private static sceneIds: WeakMap<Scene, number> = new WeakMap();
    private static pagBuildCache: Map<string, {
        pag: Pag;
        cg: CallGraph;
        fieldToVarIndex: Map<string, Set<number>>;
        callEdgeMap: Map<string, CallEdgeInfo>;
        captureEdgeMap: Map<number, CaptureEdgeInfo[]>;
        syntheticInvokeEdgeMap: Map<number, SyntheticInvokeEdgeInfo[]>;
        syntheticConstructorStoreMap: Map<number, SyntheticConstructorStoreInfo[]>;
        syntheticFieldBridgeMap: Map<string, SyntheticFieldBridgeInfo[]>;
    }> = new Map();

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
    private adaptiveContextSelector?: AdaptiveContextSelector;
    private worklistProfiler?: WorklistProfiler;
    private propagationTrace?: PropagationTrace;
    private options: TaintEngineOptions;
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
    private detectProfile: SinkDetectProfile = createEmptySinkDetectProfile();

    public verbose: boolean = true;

    constructor(scene: Scene, k: number = 1, options: TaintEngineOptions = {}) {
        this.scene = scene;
        this.tracker = new TaintTracker();
        this.ctxManager = new TaintContextManager(k);
        this.options = options;
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
        const syntheticEntryMethods = this.normalizeSyntheticEntryMethods(options.syntheticEntryMethods);
        const syntheticKey = syntheticEntryMethods.length > 0
            ? `synthetic|${syntheticEntryMethods.map(method => method.getSignature().toString()).join("||")}`
            : "pure";
        const cacheKey = `${sceneId}|entryModel|dummyMain|${syntheticKey}`;
        const cached = TaintPropagationEngine.pagBuildCache.get(cacheKey);
        if (cached) {
            this.pag = cached.pag;
            this.cg = cached.cg;
            this.fieldToVarIndex = cached.fieldToVarIndex;
            this.callEdgeMap = cached.callEdgeMap;
            this.captureEdgeMap = cached.captureEdgeMap;
            this.syntheticInvokeEdgeMap = cached.syntheticInvokeEdgeMap;
            this.syntheticConstructorStoreMap = cached.syntheticConstructorStoreMap;
            this.syntheticFieldBridgeMap = cached.syntheticFieldBridgeMap;
            this.log(`PAG cache hit: dummyMain(${syntheticKey})`);
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
        const { dummyMainMethod, cleanup } = this.createDummyMainEntry(syntheticEntryMethods);
        try {
            cgBuilder.buildDirectCallGraph([dummyMainMethod]);
            const dummyMainMethodID = cg.getCallGraphNodeByMethod(dummyMainMethod.getSignature()).getID();
            cg.setDummyMainFuncID(dummyMainMethodID);
            this.pta.setEntries([dummyMainMethodID]);
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
        this.captureEdgeMap = buildCaptureEdgeMap(this.scene, this.cg, this.pag, this.log.bind(this));
        this.syntheticInvokeEdgeMap = buildSyntheticInvokeEdges(this.scene, this.cg, this.pag, this.log.bind(this));
        this.syntheticConstructorStoreMap = buildSyntheticConstructorStoreMap(this.scene, this.cg, this.pag, this.log.bind(this));
        this.syntheticFieldBridgeMap = buildSyntheticFieldBridgeMap(this.scene, this.cg, this.pag, this.log.bind(this));
        TaintPropagationEngine.pagBuildCache.set(cacheKey, {
            pag: this.pag,
            cg: this.cg,
            fieldToVarIndex: this.fieldToVarIndex,
            callEdgeMap: this.callEdgeMap,
            captureEdgeMap: this.captureEdgeMap,
            syntheticInvokeEdgeMap: this.syntheticInvokeEdgeMap,
            syntheticConstructorStoreMap: this.syntheticConstructorStoreMap,
            syntheticFieldBridgeMap: this.syntheticFieldBridgeMap,
        });
        this.configureContextStrategy();
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

    private createDummyMainEntry(entryMethods: ArkMethod[] = []): {
        dummyMainMethod: any;
        cleanup: () => void;
    } {
        const dummyMainCreater = new DummyMainCreater(this.scene);
        if (entryMethods.length > 0) {
            dummyMainCreater.setEntryMethods(entryMethods);
        }
        dummyMainCreater.createDummyMain();
        const dummyMainMethod = dummyMainCreater.getDummyMain();
        const dummyMainFile = dummyMainMethod?.getDeclaringArkClass?.()?.getDeclaringArkFile?.();
        return {
            dummyMainMethod,
            cleanup: () => {
                if (dummyMainMethod) {
                    try {
                        this.scene.removeMethod(dummyMainMethod);
                    } catch {
                        // Ignore cleanup failures for transient dummy methods.
                    }
                }
                if (dummyMainFile) {
                    try {
                        this.scene.removeFile(dummyMainFile);
                    } catch {
                        // Ignore cleanup failures for transient dummy files.
                    }
                }
            },
        };
    }

    public setActiveReachableMethodSignatures(methodSignatures?: Set<string>): void {
        if (!methodSignatures || methodSignatures.size === 0) {
            this.activeReachableMethodSignatures = undefined;
            return;
        }
        this.activeReachableMethodSignatures = new Set(methodSignatures);
    }

    public getActiveReachableMethodSignatures(): Set<string> | undefined {
        if (!this.activeReachableMethodSignatures) return undefined;
        return new Set(this.activeReachableMethodSignatures);
    }

    public computeReachableMethodSignatures(): Set<string> {
        if (!this.cg) {
            throw new Error("PAG/CG not built. Call buildPAG() first.");
        }
        const dummyMainFuncId = this.cg.getDummyMainFuncID?.();
        if (dummyMainFuncId === undefined || dummyMainFuncId === null) {
            throw new Error("DummyMain not registered in call graph.");
        }

        const queue: number[] = [dummyMainFuncId];
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

        return reachable;
    }

    public propagate(sourceSignature: string): void {
        if (!this.pag || !this.cg) {
            throw new Error("PAG not built. Call buildPAG() first.");
        }

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
        const ruleSeeds = this.collectSourceRuleSeeds(sourceRules || []);
        if (ruleSeeds.activatedMethodSignatures.length > 0) {
            const mergedReachable = new Set<string>(this.activeReachableMethodSignatures || []);
            for (const sig of ruleSeeds.activatedMethodSignatures) {
                mergedReachable.add(sig);
            }
            // NOTE: flow-insensitive propagation does not model event-loop ordering.
            // We expand reachable methods to activate callback bodies discovered at registration sites.
            this.activeReachableMethodSignatures = mergedReachable;
        }
        const harmonySeeds = this.applyHarmonyAugmentation();

        const mergedFacts = new Map<string, TaintFact>();
        for (const fact of [...ruleSeeds.facts, ...harmonySeeds.facts]) {
            if (!mergedFacts.has(fact.id)) {
                mergedFacts.set(fact.id, fact);
            }
        }
        const seededLocals = new Set<string>([
            ...ruleSeeds.seededLocals,
            ...harmonySeeds.seededLocals,
        ]);

        for (const [ruleId, hitCount] of Object.entries(ruleSeeds.sourceRuleHits)) {
            this.markRuleHit("source", ruleId, hitCount);
        }
        for (const [ruleId, hitCount] of Object.entries(harmonySeeds.sourceRuleHits)) {
            this.markRuleHit("source", ruleId, hitCount);
        }
        if (mergedFacts.size === 0) {
            this.log("No source seeds matched by source rules or Harmony augmentation.");
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

    private applyHarmonyAugmentation(): HarmonyLifecycleSeedCollectionResult {
        if (!this.pag) {
            return {
                facts: [],
                seededLocals: [],
                sourceRuleHits: {},
            };
        }
        return collectHarmonyLifecycleSeeds({
            scene: this.scene,
            pag: this.pag,
            emptyContextId: this.ctxManager.getEmptyContextID(),
            allowedMethodSignatures: this.activeReachableMethodSignatures,
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
        const addFlows = (ruleId: string, flows: TaintFlow[]): void => {
            let added = 0;
            for (const f of flows) {
                if (maxFlowLimit !== undefined && flowMap.size >= maxFlowLimit) {
                    break;
                }
                const key = `${f.source} -> ${f.sink.toString()}`;
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
        const orderedTransferRules = this.orderRulesByFamilyTier(this.options.transferRules || []);
        const solver = new WorklistSolver({
            scene: this.scene,
            pag: this.pag,
            tracker: this.tracker,
            ctxManager: this.ctxManager,
            callEdgeMap: this.callEdgeMap,
            captureEdgeMap: this.captureEdgeMap,
            syntheticInvokeEdgeMap: this.syntheticInvokeEdgeMap,
            syntheticConstructorStoreMap: this.syntheticConstructorStoreMap,
            syntheticFieldBridgeMap: this.syntheticFieldBridgeMap,
            fieldToVarIndex: this.fieldToVarIndex,
            transferRules: orderedTransferRules,
            onTransferRuleHit: (event) => this.markRuleHit("transfer", event.ruleId, 1),
            getInitialRuleChainForFact: (fact) => this.initialFlowRuleChainForFact(fact),
            onFactRuleChain: (factId, chain) => this.upsertFactRuleChain(factId, chain),
            profiler: this.worklistProfiler,
            propagationTrace: this.propagationTrace,
            allowedMethodSignatures: this.activeReachableMethodSignatures,
            enableHarmonyAppStorageModeling: this.options.enableHarmonyAppStorageModeling !== false,
            enableHarmonyStateModeling: this.options.enableHarmonyStateModeling !== false,
            log: this.log.bind(this),
        });
        solver.solve(worklist, visited);
    }

    private collectSourceRuleSeeds(
        sourceRules: SourceRule[]
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
            allowedMethodSignatures: this.activeReachableMethodSignatures,
        });
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
        return runSinkDetector(
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
    }

    private resolveSinkSignatureMatchMode(rule: SinkRule): "contains" | "equals" {
        switch (rule.match.kind) {
            case "signature_equals":
            case "callee_signature_equals":
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
        const endpoint = rule.sinkTargetRef?.endpoint || rule.sinkTarget;
        const path = rule.sinkTargetRef?.path;
        return {
            targetEndpoint: endpoint,
            targetPath: path,
            invokeKind: rule.invokeKind,
            argCount: rule.argCount,
            typeHint: rule.typeHint,
        };
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

    private getOrCreateSceneId(): number {
        let sceneId = TaintPropagationEngine.sceneIds.get(this.scene);
        if (!sceneId) {
            sceneId = TaintPropagationEngine.sceneIdSeed++;
            TaintPropagationEngine.sceneIds.set(this.scene, sceneId);
        }
        return sceneId;
    }

}
