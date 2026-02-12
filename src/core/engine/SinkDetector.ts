import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { CallGraph } from "../../../arkanalyzer/out/src/callgraph/model/CallGraph";
import { Pag } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { TaintTracker } from "../TaintTracker";
import { TaintFlow } from "../TaintFlow";

export function detectSinks(
    scene: Scene,
    cg: CallGraph,
    pag: Pag,
    tracker: TaintTracker,
    sinkSignature: string,
    log: (msg: string) => void
): TaintFlow[] {
    const flows: TaintFlow[] = [];
    if (!cg) return flows;

    log(`\n=== Detecting sinks for: "${sinkSignature}" ===`);
    let sinksChecked = 0;

    for (const method of scene.getMethods()) {
        const cfg = method.getCfg();
        if (!cfg) continue;

        log(`Checking method "${method.getName()}" for sinks...`);

        for (const stmt of cfg.getStmts()) {
            if (!stmt.containsInvokeExpr()) continue;

            const invokeExpr = stmt.getInvokeExpr();
            if (!invokeExpr) continue;

            const calleeSignature = invokeExpr.getMethodSignature().toString();
            if (!calleeSignature.includes(sinkSignature)) continue;

            sinksChecked++;
            log(`  Found sink call: ${calleeSignature}`);

            const args = invokeExpr.getArgs();
            for (let i = 0; i < args.length; i++) {
                const arg = args[i];
                const pagNodes = pag.getNodesByValue(arg);
                if (!pagNodes || pagNodes.size === 0) continue;

                for (const nodeId of pagNodes.values()) {
                    const isTainted = tracker.isTaintedAnyContext(nodeId);
                    log(`    Checking arg ${i}, node ${nodeId}, tainted: ${isTainted}`);
                    if (!isTainted) continue;

                    const source = tracker.getSourceAnyContext(nodeId)!;
                    log(`    *** TAINT FLOW DETECTED! Source: ${source} ***`);
                    flows.push(new TaintFlow(source, stmt));
                    break;
                }
            }
        }
    }

    log(`Checked ${sinksChecked} sink call(s), found ${flows.length} flow(s)`);
    return flows;
}
