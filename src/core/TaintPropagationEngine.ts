
import { Scene } from "../../arkanalyzer/src/Scene";
import { PointerAnalysis } from "../../arkanalyzer/src/callgraph/pointerAnalysis/PointerAnalysis";
import { Pag } from "../../arkanalyzer/src/callgraph/pointerAnalysis/Pag";
import { CallGraph } from "../../arkanalyzer/src/model/CallGraph";
import { TaintFact } from "./TaintFact";
import { TaintFlow } from "../models/TaintFlow";
import { TaintTracker } from "./TaintTracker";
import { ArkAssignStmt } from "../../arkanalyzer/src/core/model/ArkStmt";

export class TaintPropagationEngine {
    private scene: Scene;
    private pag!: Pag;
    private cg!: CallGraph;
    private tracker: TaintTracker;

    constructor(scene: Scene) {
        this.scene = scene;
        this.tracker = new TaintTracker();
    }

    public async buildPAG(): Promise<void> {
        let pta = new PointerAnalysis(this.scene);
        await pta.analyze();

        this.pag = pta.getPag();
        this.cg = pta.getCallGraph();
    }

    public propagate(sourceSignature: string): void {
        if (!this.pag || !this.cg) {
            throw new Error("PAG not built. Call buildPAG() first.");
        }

        let worklist: TaintFact[] = [];
        let visited = new Set<string>();

        // 1. Mark Sources and initialize WorkList
        for (let callSite of this.cg.getAllCallSites()) {
            if (callSite.getCallee().getSignature().toString().includes(sourceSignature)) {
                let stmt = callSite.getStmt();
                if (stmt instanceof ArkAssignStmt) {
                    let leftOp = stmt.getLeftOp();
                    let nodes = this.pag.getNodesByValue(leftOp);

                    for (let nodeId of nodes) {
                        let node = this.pag.getNode(nodeId);
                        let fact = new TaintFact(node, sourceSignature);
                        if (!visited.has(fact.id)) {
                            worklist.push(fact);
                            visited.add(fact.id);
                            this.tracker.markTainted(nodeId, sourceSignature);
                        }
                    }
                }
            }
        }

        // 2. Process WorkList
        while (worklist.length > 0) {
            let fact = worklist.pop()!;
            let node = fact.node;

            let outEdges = this.pag.getOutEdges(node.id);
            if (!outEdges) continue;

            for (let edge of outEdges) {
                let targetNode = this.pag.getNode(edge.getDst());
                let newFact = new TaintFact(targetNode, fact.source);

                if (!visited.has(newFact.id)) {
                    visited.add(newFact.id);
                    worklist.push(newFact);
                    this.tracker.markTainted(targetNode.id, fact.source);
                }
            }
        }
    }

    public detectSinks(sinkSignature: string): TaintFlow[] {
        let flows: TaintFlow[] = [];
        if (!this.cg) return flows;

        for (let callSite of this.cg.getAllCallSites()) {
            if (callSite.getCallee().getSignature().toString().includes(sinkSignature)) {
                let args = callSite.getArgs();
                for (let arg of args) {
                    let argNodes = this.pag.getNodesByValue(arg);
                    for (let nodeId of argNodes) {
                        if (this.tracker.isTainted(nodeId)) {
                            let source = this.tracker.getSource(nodeId)!;
                            flows.push(new TaintFlow(source, callSite));
                            break;
                        }
                    }
                }
            }
        }
        return flows;
    }
}
