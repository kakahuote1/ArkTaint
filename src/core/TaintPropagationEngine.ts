import { Scene } from "../../arkanalyzer/out/src/Scene";
import { PointerAnalysis } from "../../arkanalyzer/out/src/callgraph/pointerAnalysis/PointerAnalysis";
import { PointerAnalysisConfig } from "../../arkanalyzer/out/src/callgraph/pointerAnalysis/PointerAnalysisConfig";
import { Pag, PagNode } from "../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { CallGraph } from "../../arkanalyzer/out/src/callgraph/model/CallGraph";
import { CallGraphBuilder } from "../../arkanalyzer/out/src/callgraph/model/builder/CallGraphBuilder";
import { ArkAssignStmt } from "../../arkanalyzer/out/src/core/base/Stmt";
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

    public async buildPAG(entryMethodName: string = "main"): Promise<void> {
        const cg = new CallGraph(this.scene);
        const cgBuilder = new CallGraphBuilder(cg, this.scene);
        cgBuilder.buildDirectCallGraphForScene();

        const pag = new Pag();
        let mainMethod = null;
        for (const method of this.scene.getMethods()) {
            if (method.getName() === entryMethodName) {
                mainMethod = method;
                break;
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
            profiler: this.worklistProfiler,
            propagationTrace: this.propagationTrace,
            log: this.log.bind(this),
        });
        solver.solve(worklist, visited);
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
