import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { CallGraph } from "../../../arkanalyzer/out/src/callgraph/model/CallGraph";
import { Pag } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt, ArkIfStmt, ArkInvokeStmt, ArkReturnVoidStmt, ArkThrowStmt } from "../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkParameterRef } from "../../../arkanalyzer/out/src/core/base/Ref";
import { Constant } from "../../../arkanalyzer/out/src/core/base/Constant";
import { Local } from "../../../arkanalyzer/out/src/core/base/Local";
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

            if (shouldSkipSinkByControlFlow(method, stmt, scene, log)) {
                log("    [Sink-SKIP] statically unreachable by control-flow guard.");
                continue;
            }

            const args = invokeExpr.getArgs();
            for (let i = 0; i < args.length; i++) {
                const arg = args[i];
                const pagNodes = pag.getNodesByValue(arg);
                if (!pagNodes || pagNodes.size === 0) continue;

                for (const nodeId of pagNodes.values()) {
                    const isTainted = tracker.isTaintedAnyContext(nodeId);
                    log(`    Checking arg ${i}, node ${nodeId}, tainted: ${isTainted}`);
                    if (!isTainted) continue;

                    if (arg instanceof Local && shouldSkipLocalByUnreachableTaintDefs(method, stmt, arg, log)) {
                        continue;
                    }

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

function shouldSkipSinkByControlFlow(method: any, sinkStmt: any, scene: Scene, log: (msg: string) => void): boolean {
    const cfg = method.getCfg();
    if (!cfg) return false;

    const stmtToBlock = cfg.getStmtToBlock();
    const sinkBlock = stmtToBlock.get(sinkStmt);
    if (!sinkBlock) return false;
    const sinkBlockStmts = sinkBlock.getStmts();
    const sinkIdx = sinkBlockStmts.indexOf(sinkStmt);

    if (sinkIdx >= 0) {
        for (let i = 0; i < sinkIdx; i++) {
            const s = sinkBlockStmts[i];
            if (s instanceof ArkThrowStmt || s instanceof ArkReturnVoidStmt) {
                return true;
            }
        }
    }

    for (const s of cfg.getStmts()) {
        if (!(s instanceof ArkIfStmt)) continue;
        const guard = parseSimpleEqGuard(s.toString());
        if (!guard) continue;
        if (!allCallsitesPassConstant(scene, method, guard.paramName, guard.literal)) continue;

        const condBlock = stmtToBlock.get(s);
        if (!condBlock) continue;
        const succs = condBlock.getSuccessors();
        if (succs.length !== 2) continue;

        const returnSucc = succs.find((b: any) => hasImmediateReturn(b));
        const otherSucc = succs.find((b: any) => b !== returnSucc);
        if (!returnSucc || !otherSucc) continue;

        const ifLine = s.getOriginPositionInfo?.().getLineNo?.() ?? -1;
        const sinkLine = sinkStmt.getOriginPositionInfo?.().getLineNo?.() ?? -1;
        const sinkLikelyOutsideIf = ifLine > 0 && sinkLine > ifLine + 1;

        if (sinkLikelyOutsideIf && blockCanReachStmt(otherSucc, sinkStmt, stmtToBlock)) {
            log(`    [Sink-Guard] all callsites satisfy '${guard.paramName} === ${guard.literal}'`);
            return true;
        }
    }

    return false;
}

function hasImmediateReturn(block: any): boolean {
    const stmts = block.getStmts();
    return stmts.length > 0 && stmts[0] instanceof ArkReturnVoidStmt;
}

function blockCanReachStmt(startBlock: any, targetStmt: any, stmtToBlock: Map<any, any>): boolean {
    const targetBlock = stmtToBlock.get(targetStmt);
    if (!targetBlock) return false;
    if (startBlock === targetBlock) return true;

    const q: any[] = [startBlock];
    const vis = new Set<any>();
    while (q.length > 0) {
        const b = q.shift();
        if (vis.has(b)) continue;
        vis.add(b);
        for (const succ of b.getSuccessors()) {
            if (succ === targetBlock) return true;
            if (!vis.has(succ)) q.push(succ);
        }
    }
    return false;
}

function parseSimpleEqGuard(text: string): { paramName: string; literal: string } | null {
    const m = text.match(/if\s+([A-Za-z_][A-Za-z0-9_]*)\s*===\s*('(?:[^']*)'|"(?:[^"]*)"|`(?:[^`]*)`|-?\d+)/);
    if (!m) return null;
    return { paramName: m[1], literal: normalizeLiteral(m[2]) };
}

function allCallsitesPassConstant(scene: Scene, method: any, paramName: string, literal: string): boolean {
    const paramIndex = resolveParamIndex(method, paramName);
    if (paramIndex < 0) return false;

    const sigText = method.getSignature().toString();
    let foundCallsite = false;

    for (const m of scene.getMethods()) {
        const cfg = m.getCfg();
        if (!cfg) continue;
        for (const s of cfg.getStmts()) {
            if (!(s instanceof ArkInvokeStmt) && !(s instanceof ArkAssignStmt)) continue;
            if (!s.containsInvokeExpr || !s.containsInvokeExpr()) continue;
            const ie = s.getInvokeExpr();
            if (!ie) continue;
            if (ie.getMethodSignature()?.toString() !== sigText) continue;
            const args = ie.getArgs ? ie.getArgs() : [];
            if (args.length <= paramIndex) continue;
            foundCallsite = true;
            const arg = args[paramIndex];
            if (!(arg instanceof Constant)) return false;
            if (normalizeLiteral(arg.toString()) !== literal) return false;
        }
    }

    return foundCallsite;
}

function resolveParamIndex(method: any, paramName: string): number {
    const cfg = method.getCfg();
    if (!cfg) return -1;
    for (const s of cfg.getStmts()) {
        if (!(s instanceof ArkAssignStmt)) continue;
        const right = s.getRightOp();
        const left = s.getLeftOp();
        if (!(right instanceof ArkParameterRef) || !(left instanceof Local)) continue;
        if (left.getName() !== paramName) continue;
        const text = right.toString();
        const m = text.match(/parameter(\d+)/);
        if (!m) return -1;
        return Number(m[1]);
    }
    return -1;
}

function normalizeLiteral(text: string): string {
    return text.replace(/^['"`]/, "").replace(/['"`]$/, "");
}

function getParameterLocalNames(method: any): Set<string> {
    const names = new Set<string>();
    const cfg = method.getCfg();
    if (!cfg) return names;
    for (const s of cfg.getStmts()) {
        if (!(s instanceof ArkAssignStmt)) continue;
        if (!(s.getRightOp() instanceof ArkParameterRef)) continue;
        const left = s.getLeftOp();
        if (left instanceof Local) names.add(left.getName());
    }
    return names;
}

function shouldSkipLocalByUnreachableTaintDefs(method: any, sinkStmt: any, localArg: Local, log: (msg: string) => void): boolean {
    const cfg = method.getCfg();
    if (!cfg) return false;

    const stmtToBlock = cfg.getStmtToBlock();
    const sinkBlock = stmtToBlock.get(sinkStmt);
    if (!sinkBlock) return false;
    const sinkIdx = sinkBlock.getStmts().indexOf(sinkStmt);
    if (sinkIdx < 0) return false;

    const paramLocalNames = getParameterLocalNames(method);
    let taintingDefCount = 0;
    let reachableTaintingDefCount = 0;

    for (const s of cfg.getStmts()) {
        if (!(s instanceof ArkAssignStmt)) continue;
        const left = s.getLeftOp();
        if (!(left instanceof Local) || left.getName() !== localArg.getName()) continue;

        const right = s.getRightOp();
        if (!isLikelyTaintingRHS(right, paramLocalNames)) continue;
        taintingDefCount++;

        const defBlock = stmtToBlock.get(s);
        if (!defBlock) continue;

        let reachable = false;
        if (defBlock === sinkBlock) {
            const defIdx = defBlock.getStmts().indexOf(s);
            if (defIdx >= 0 && defIdx < sinkIdx) {
                reachable = true;
            } else if (defIdx > sinkIdx && canReachSinkViaLoopBackedge(defBlock, sinkIdx)) {
                reachable = true;
            }
        } else {
            reachable = blockCanReachStmt(defBlock, sinkStmt, stmtToBlock);
        }
        if (reachable) reachableTaintingDefCount++;
    }

    if (taintingDefCount > 0 && reachableTaintingDefCount === 0) {
        log(`    [Arg-SKIP] local '${localArg.getName()}' only has non-reaching taint-defs before sink.`);
        return true;
    }
    return false;
}

function canReachSinkViaLoopBackedge(loopBodyBlock: any, sinkIdx: number): boolean {
    const succs = loopBodyBlock.getSuccessors ? loopBodyBlock.getSuccessors() : [];
    for (const succ of succs) {
        if (!blockCanReachBlock(succ, loopBodyBlock)) continue;

        const condLocalNames = collectIfConditionLocalNames(succ);
        if (condLocalNames.size === 0) continue;
        if (hasConditionLocalAssignmentAfterIndex(loopBodyBlock, sinkIdx, condLocalNames)) continue;
        return true;
    }
    return false;
}

function blockCanReachBlock(startBlock: any, targetBlock: any): boolean {
    if (startBlock === targetBlock) return true;
    const q: any[] = [startBlock];
    const vis = new Set<any>();
    while (q.length > 0) {
        const b = q.shift();
        if (vis.has(b)) continue;
        vis.add(b);
        for (const succ of b.getSuccessors()) {
            if (succ === targetBlock) return true;
            if (!vis.has(succ)) q.push(succ);
        }
    }
    return false;
}

function collectIfConditionLocalNames(block: any): Set<string> {
    const names = new Set<string>();
    const stmts = block.getStmts ? block.getStmts() : [];
    for (const s of stmts) {
        if (!(s instanceof ArkIfStmt)) continue;
        const uses = s.getUses ? s.getUses() : [];
        for (const u of uses) {
            if (u instanceof Local) names.add(u.getName());
        }
        break;
    }
    return names;
}

function hasConditionLocalAssignmentAfterIndex(block: any, idx: number, localNames: Set<string>): boolean {
    const stmts = block.getStmts ? block.getStmts() : [];
    for (let i = idx + 1; i < stmts.length; i++) {
        const s = stmts[i];
        if (!(s instanceof ArkAssignStmt)) continue;
        const left = s.getLeftOp();
        if (left instanceof Local && localNames.has(left.getName())) {
            return true;
        }
    }
    return false;
}

function isLikelyTaintingRHS(rhs: any, paramLocalNames: Set<string>): boolean {
    if (rhs instanceof Local) {
        return paramLocalNames.has(rhs.getName()) || rhs.getName().includes("taint");
    }
    if (rhs instanceof Constant) {
        return false;
    }
    const text = rhs?.toString?.() || "";
    return text.includes("taint");
}
