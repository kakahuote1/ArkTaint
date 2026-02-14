import { Scene } from "../../arkanalyzer/out/src/Scene";
import { PointerAnalysis } from "../../arkanalyzer/out/src/callgraph/pointerAnalysis/PointerAnalysis";
import { PointerAnalysisConfig } from "../../arkanalyzer/out/src/callgraph/pointerAnalysis/PointerAnalysisConfig";
import { Pag, PagNode } from "../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { CallGraph } from "../../arkanalyzer/out/src/callgraph/model/CallGraph";
import { CallGraphBuilder } from "../../arkanalyzer/out/src/callgraph/model/builder/CallGraphBuilder";
import { ArkAssignStmt } from "../../arkanalyzer/out/src/core/base/Stmt";
import { ArkParameterRef } from "../../arkanalyzer/out/src/core/base/Ref";
import { Local } from "../../arkanalyzer/out/src/core/base/Local";
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
    SyntheticInvokeEdgeInfo,
    SyntheticConstructorStoreInfo
} from "./engine/SyntheticInvokeEdgeBuilder";
import { WorklistSolver } from "./engine/WorklistSolver";
import { detectSinks as runSinkDetector } from "./engine/SinkDetector";
import { WorklistProfiler, WorklistProfileSnapshot } from "./engine/WorklistProfiler";
import { PropagationTrace } from "./engine/PropagationTrace";
import { SinkRule, SourceRule, TransferRule } from "./rules/RuleSchema";
import * as fs from "fs";
import * as path from "path";

export interface DebugOptions {
    enableWorklistProfile?: boolean;
    enablePropagationTrace?: boolean;
    propagationTraceMaxEdges?: number;
}

export interface TaintEngineOptions {
    contextStrategy?: "fixed" | "adaptive";
    adaptiveContext?: AdaptiveContextSelectorOptions;
    transferRules?: TransferRule[];
    debug?: DebugOptions;
}

export class TaintPropagationEngine {
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
    private adaptiveContextSelector?: AdaptiveContextSelector;
    private worklistProfiler?: WorklistProfiler;
    private propagationTrace?: PropagationTrace;
    private options: TaintEngineOptions;

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

    public async buildPAG(entryMethodName: string = "main", entryMethodPathHint?: string): Promise<void> {
        const cg = new CallGraph(this.scene);
        const cgBuilder = new CallGraphBuilder(cg, this.scene);
        cgBuilder.buildDirectCallGraphForScene();

        const pag = new Pag();
        const candidates = this.scene.getMethods().filter(method => method.getName() === entryMethodName);
        let mainMethod = candidates.length > 0 ? candidates[0] : null;

        if (entryMethodPathHint && candidates.length > 0) {
            const normalizedHint = entryMethodPathHint.replace(/\\/g, "/");
            const hintedMethod = candidates.find(method => method.getSignature().toString().includes(normalizedHint));
            if (hintedMethod) {
                mainMethod = hintedMethod;
            }
        }

        if (!mainMethod) {
            throw new Error(`No ${entryMethodName}() method found in scene`);
        }

        const entryMethodID = cg.getCallGraphNodeByMethod(mainMethod.getSignature()).getID();

        const config = PointerAnalysisConfig.create(
            0,
            "./out",
            false,
            false,
            false
        );

        this.pta = new PointerAnalysis(pag, cg, this.scene, config);
        this.pta.setEntries([entryMethodID]);
        this.pta.start();

        this.pag = this.pta.getPag();
        this.cg = cg;

        this.log(`PAG nodes: ${this.pag.getNodeNum()}, edges: ${this.pag.getEdgeNum()}`);
        this.log(`CG nodes: ${this.cg.getNodeNum()}, edges: ${this.cg.getEdgeNum()}`);

        this.fieldToVarIndex = buildFieldToVarIndex(this.pag, this.log.bind(this));
        this.callEdgeMap = buildCallEdgeMap(this.scene, this.cg, this.pag, this.log.bind(this));
        this.captureEdgeMap = buildCaptureEdgeMap(this.scene, this.cg, this.pag, this.log.bind(this));
        this.syntheticInvokeEdgeMap = buildSyntheticInvokeEdges(this.scene, this.cg, this.pag, this.log.bind(this));
        this.syntheticConstructorStoreMap = buildSyntheticConstructorStoreMap(this.scene, this.cg, this.pag, this.log.bind(this));
        this.configureContextStrategy();
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
                this.tracker.markTainted(nodeId, emptyCtx, sourceSignature);
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
        const worklist: TaintFact[] = [];
        const visited: Set<string> = new Set();
        const emptyCtx = this.ctxManager.getEmptyContextID();

        for (const seed of seeds) {
            const fact = new TaintFact(seed, "entry_arg", emptyCtx);
            if (visited.has(fact.id)) continue;

            visited.add(fact.id);
            worklist.push(fact);
            this.tracker.markTainted(seed.getID(), emptyCtx, "entry_arg");
        }

        this.log(`Initialized WorkList with ${worklist.length} seeds.`);
        this.runWorkList(worklist, visited);
    }

    public propagateWithSourceRules(
        sourceRules: SourceRule[],
        options: { entryMethodName?: string; entryMethodPathHint?: string } = {}
    ): { seedCount: number; seededLocals: string[] } {
        const seeds = this.collectSourceRuleSeeds(sourceRules || [], options);
        if (seeds.nodes.length === 0) {
            this.log("No source seeds matched by source rules.");
            return {
                seedCount: 0,
                seededLocals: [],
            };
        }

        this.log(`Initialized WorkList with ${seeds.nodes.length} source-rule seeds.`);
        this.propagateWithSeeds(seeds.nodes);
        return {
            seedCount: seeds.nodes.length,
            seededLocals: seeds.seededLocals,
        };
    }

    public detectSinksByRules(sinkRules: SinkRule[]): TaintFlow[] {
        if (!sinkRules || sinkRules.length === 0) return [];

        const flowMap = new Map<string, TaintFlow>();
        const addFlows = (flows: TaintFlow[]): void => {
            for (const f of flows) {
                const key = `${f.source} -> ${f.sink.toString()}`;
                if (!flowMap.has(key)) {
                    flowMap.set(key, f);
                }
            }
        };

        for (const rule of sinkRules) {
            const signatures = this.resolveSinkRuleSignatures(rule);
            for (const signature of signatures) {
                addFlows(this.detectSinks(signature));
            }
        }

        return Array.from(flowMap.values());
    }

    private runWorkList(worklist: TaintFact[], visited: Set<string>): void {
        this.prepareDebugCollectors();
        const solver = new WorklistSolver({
            scene: this.scene,
            pag: this.pag,
            tracker: this.tracker,
            ctxManager: this.ctxManager,
            callEdgeMap: this.callEdgeMap,
            captureEdgeMap: this.captureEdgeMap,
            syntheticInvokeEdgeMap: this.syntheticInvokeEdgeMap,
            syntheticConstructorStoreMap: this.syntheticConstructorStoreMap,
            fieldToVarIndex: this.fieldToVarIndex,
            transferRules: this.options.transferRules || [],
            profiler: this.worklistProfiler,
            propagationTrace: this.propagationTrace,
            log: this.log.bind(this),
        });
        solver.solve(worklist, visited);
    }

    private collectSourceRuleSeeds(
        sourceRules: SourceRule[],
        options: { entryMethodName?: string; entryMethodPathHint?: string }
    ): { nodes: PagNode[]; seededLocals: string[] } {
        const methods = this.resolveSourceScopeMethods(options.entryMethodName, options.entryMethodPathHint);
        const nodes: PagNode[] = [];
        const seededLocals = new Set<string>();
        const seenNodeIds = new Set<number>();

        for (const method of methods) {
            const body = method.getBody();
            if (!body) continue;

            const methodSignature = method.getSignature().toString();
            const methodName = method.getName();
            const paramLocalNames = this.getParameterLocalNames(method);

            for (const local of body.getLocals().values()) {
                const localName = local.getName();
                const matched = sourceRules.some(rule => this.matchesSourceRule(
                    rule,
                    methodSignature,
                    methodName,
                    localName,
                    paramLocalNames
                ));
                if (!matched) continue;

                const pagNodes = this.pag.getNodesByValue(local);
                if (!pagNodes) continue;
                for (const nodeId of pagNodes.values()) {
                    if (seenNodeIds.has(nodeId)) continue;
                    seenNodeIds.add(nodeId);
                    nodes.push(this.pag.getNode(nodeId) as PagNode);
                    seededLocals.add(`${methodName}:${localName}`);
                }
            }
        }

        return {
            nodes,
            seededLocals: [...seededLocals].sort(),
        };
    }

    private resolveSourceScopeMethods(entryMethodName?: string, entryMethodPathHint?: string): ArkMethod[] {
        const allMethods = this.scene.getMethods().filter(m => m.getName() !== "%dflt");
        if (!entryMethodName) return allMethods;

        const candidates = allMethods.filter(m => m.getName() === entryMethodName);
        if (!entryMethodPathHint) return candidates;

        const normalizedHint = entryMethodPathHint.replace(/\\/g, "/");
        const hinted = candidates.filter(m => m.getSignature().toString().includes(normalizedHint));
        return hinted.length > 0 ? hinted : candidates;
    }

    private getParameterLocalNames(method: ArkMethod): Set<string> {
        const out = new Set<string>();
        const cfg = method.getCfg();
        if (!cfg) return out;

        for (const stmt of cfg.getStmts()) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            if (!(stmt.getRightOp() instanceof ArkParameterRef)) continue;
            const leftOp = stmt.getLeftOp();
            if (leftOp instanceof Local) out.add(leftOp.getName());
        }
        return out;
    }

    private matchesSourceRule(
        rule: SourceRule,
        methodSignature: string,
        methodName: string,
        localName: string,
        paramLocalNames: Set<string>
    ): boolean {
        if (rule.profile === "entry_param" && !paramLocalNames.has(localName)) {
            return false;
        }

        const value = rule.match.value || "";
        switch (rule.match.kind) {
            case "local_name_regex":
                try {
                    return new RegExp(value).test(localName);
                } catch {
                    return false;
                }
            case "method_name_equals":
                return methodName === value;
            case "method_name_regex":
                try {
                    return new RegExp(value).test(methodName);
                } catch {
                    return false;
                }
            case "signature_contains":
                return methodSignature.includes(value);
            case "signature_regex":
                try {
                    return new RegExp(value).test(methodSignature);
                } catch {
                    return false;
                }
            default:
                return false;
        }
    }

    private resolveSinkRuleSignatures(rule: SinkRule): string[] {
        const methods = this.scene.getMethods();
        const value = rule.match.value || "";
        switch (rule.match.kind) {
            case "signature_contains":
                return [value];
            case "signature_regex": {
                let re: RegExp;
                try {
                    re = new RegExp(value);
                } catch {
                    return [];
                }
                return methods
                    .map(m => m.getSignature().toString())
                    .filter(sig => re.test(sig));
            }
            case "method_name_equals":
                return methods
                    .filter(m => m.getName() === value)
                    .map(m => m.getSignature().toString());
            case "method_name_regex": {
                let re: RegExp;
                try {
                    re = new RegExp(value);
                } catch {
                    return [];
                }
                return methods
                    .filter(m => re.test(m.getName()))
                    .map(m => m.getSignature().toString());
            }
            case "local_name_regex":
                return [];
            default:
                return [];
        }
    }

    public detectSinks(sinkSignature: string): TaintFlow[] {
        if (!this.cg) return [];
        return runSinkDetector(
            this.scene,
            this.cg,
            this.pag,
            this.tracker,
            sinkSignature,
            this.log.bind(this)
        );
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
        const out: { profilePath?: string; dotPath?: string } = {};
        const safeTag = tag.replace(/[^A-Za-z0-9_.-]/g, "_");
        fs.mkdirSync(outputDir, { recursive: true });

        const profile = this.getWorklistProfile();
        if (profile) {
            const profilePath = path.join(outputDir, `worklist_profile_${safeTag}.json`);
            fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2), "utf-8");
            out.profilePath = profilePath;
        }

        const dot = this.getPropagationTraceDot(`propagation_${safeTag}`);
        if (dot) {
            const dotPath = path.join(outputDir, `taint_trace_${safeTag}.dot`);
            fs.writeFileSync(dotPath, dot, "utf-8");
            out.dotPath = dotPath;
        }
        return out;
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
        this.worklistProfiler = this.options.debug?.enableWorklistProfile ? new WorklistProfiler() : undefined;
        this.propagationTrace = this.options.debug?.enablePropagationTrace
            ? new PropagationTrace({ maxEdges: this.options.debug?.propagationTraceMaxEdges })
            : undefined;
    }
}
