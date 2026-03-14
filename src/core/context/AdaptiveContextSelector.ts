import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { CallGraph } from "../../../arkanalyzer/out/src/callgraph/model/CallGraph";
import { ArkAssignStmt } from "../../../arkanalyzer/out/src/core/base/Stmt";

export interface AdaptiveContextSelectorOptions {
    lowK?: number;
    highK?: number;
    veryHighK?: number;
    highFanInThreshold?: number;
    veryHighFanInThreshold?: number;
    allowSafeZeroK?: boolean;
    zeroKFanInThreshold?: number;
    zeroKMaxCallSites?: number;
    conflictHotMethods?: string[];
    conflictMinK?: number;
}

interface SelectorStats {
    methodName: string;
    fanIn: number;
    callSiteCount: number;
    returnValueUsed: boolean;
    selectedK: number;
    conflictRefined: boolean;
}

/**
 * v1: 基于调用图扇入度的自适应 k 选择器。
 * 说明：当前阶段仅启用 {1,2} 分层，避免破坏 return 上下文匹配语义。
 */
export class AdaptiveContextSelector {
    private readonly opts: Required<AdaptiveContextSelectorOptions>;
    private readonly fanInByMethodName: Map<string, number> = new Map();
    private readonly callSiteCountByMethodName: Map<string, number> = new Map();
    private readonly returnValueUsedByMethodName: Map<string, boolean> = new Map();
    private readonly selectedKByMethodName: Map<string, number> = new Map();
    private readonly conflictRefinedMethods: Set<string> = new Set();

    constructor(scene: Scene, cg: CallGraph, options: AdaptiveContextSelectorOptions = {}) {
        this.opts = {
            lowK: Math.max(0, options.lowK ?? 1),
            highK: Math.max(1, options.highK ?? 2),
            veryHighK: Math.max(1, options.veryHighK ?? 2),
            highFanInThreshold: Math.max(1, options.highFanInThreshold ?? 3),
            veryHighFanInThreshold: Math.max(1, options.veryHighFanInThreshold ?? 6),
            allowSafeZeroK: options.allowSafeZeroK ?? false,
            zeroKFanInThreshold: Math.max(0, options.zeroKFanInThreshold ?? 1),
            zeroKMaxCallSites: Math.max(1, options.zeroKMaxCallSites ?? 1),
            conflictHotMethods: options.conflictHotMethods ?? [],
            conflictMinK: Math.max(1, options.conflictMinK ?? Math.max(2, options.highK ?? 2)),
        };
        this.preAnalyze(scene, cg);
        if (this.opts.conflictHotMethods.length > 0) {
            this.applyConflictRefinement(this.opts.conflictHotMethods, this.opts.conflictMinK);
        }
    }

    public selectK(callerMethodName: string, calleeMethodName: string, defaultK: number): number {
        const selected = this.selectedKByMethodName.get(calleeMethodName);
        if (selected === undefined) {
            return Math.max(0, defaultK);
        }
        return selected;
    }

    public getSummary(): string {
        const stats = this.getStats();
        const high = stats.filter(s => s.selectedK >= this.opts.highK).length;
        const veryHigh = stats.filter(s => s.selectedK >= this.opts.veryHighK && s.fanIn >= this.opts.veryHighFanInThreshold).length;
        const zero = stats.filter(s => s.selectedK === 0).length;
        const refined = stats.filter(s => s.conflictRefined).length;
        return `methods=${stats.length}, highK=${high}, veryHighK=${veryHigh}, zeroK=${zero}, refined=${refined}, thresholds=[${this.opts.highFanInThreshold},${this.opts.veryHighFanInThreshold}]`;
    }

    public getTopHotspots(limit: number = 10): SelectorStats[] {
        return this.getStats()
            .sort((a, b) => b.fanIn - a.fanIn)
            .slice(0, Math.max(1, limit));
    }

    private getStats(): SelectorStats[] {
        const stats: SelectorStats[] = [];
        for (const [methodName, fanIn] of this.fanInByMethodName.entries()) {
            const selectedK = this.selectedKByMethodName.get(methodName) ?? this.opts.lowK;
            const callSiteCount = this.callSiteCountByMethodName.get(methodName) ?? 0;
            const returnValueUsed = this.returnValueUsedByMethodName.get(methodName) ?? false;
            const conflictRefined = this.conflictRefinedMethods.has(methodName);
            stats.push({ methodName, fanIn, callSiteCount, returnValueUsed, selectedK, conflictRefined });
        }
        return stats;
    }

    private preAnalyze(scene: Scene, cg: CallGraph): void {
        const callerSetByCalleeName: Map<string, Set<string>> = new Map();
        const callSiteSetByCalleeName: Map<string, Set<string>> = new Map();
        const returnValueUsedByCalleeName: Map<string, boolean> = new Map();

        for (const caller of scene.getMethods()) {
            const cfg = caller.getCfg();
            if (!cfg) continue;
            const callerSig = caller.getSignature().toString();

            for (const stmt of cfg.getStmts()) {
                if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
                const callsites = cg.getCallSiteByStmt(stmt) || [];
                if (callsites.length === 0) continue;

                for (const cs of callsites) {
                    const calleeFuncId = cs.getCalleeFuncID();
                    if (!calleeFuncId) continue;
                    const callee = cg.getArkMethodByFuncID(calleeFuncId);
                    if (!callee) continue;

                    const calleeName = callee.getName();
                    if (!callerSetByCalleeName.has(calleeName)) {
                        callerSetByCalleeName.set(calleeName, new Set<string>());
                    }
                    callerSetByCalleeName.get(calleeName)!.add(callerSig);

                    if (!callSiteSetByCalleeName.has(calleeName)) {
                        callSiteSetByCalleeName.set(calleeName, new Set<string>());
                    }
                    const lineNo = stmt.getOriginPositionInfo?.().getLineNo?.() ?? -1;
                    callSiteSetByCalleeName.get(calleeName)!.add(`${callerSig}@${lineNo}@${calleeFuncId}`);

                    if (stmt instanceof ArkAssignStmt) {
                        returnValueUsedByCalleeName.set(calleeName, true);
                    } else if (!returnValueUsedByCalleeName.has(calleeName)) {
                        returnValueUsedByCalleeName.set(calleeName, false);
                    }
                }
            }
        }

        for (const method of scene.getMethods()) {
            const methodName = method.getName();
            const fanIn = callerSetByCalleeName.get(methodName)?.size ?? 0;
            const callSiteCount = callSiteSetByCalleeName.get(methodName)?.size ?? 0;
            const returnValueUsed = returnValueUsedByCalleeName.get(methodName) ?? false;
            this.fanInByMethodName.set(methodName, fanIn);
            this.callSiteCountByMethodName.set(methodName, callSiteCount);
            this.returnValueUsedByMethodName.set(methodName, returnValueUsed);
            this.selectedKByMethodName.set(methodName, this.decideK(methodName, fanIn, callSiteCount, returnValueUsed));
        }
    }

    private decideK(methodName: string, fanIn: number, callSiteCount: number, returnValueUsed: boolean): number {
        if (this.canUseZeroK(fanIn, callSiteCount, returnValueUsed)) {
            return 0;
        }
        if (fanIn >= this.opts.veryHighFanInThreshold) {
            return this.opts.veryHighK;
        }
        if (fanIn >= this.opts.highFanInThreshold) {
            return this.opts.highK;
        }
        return this.opts.lowK;
    }

    private canUseZeroK(fanIn: number, callSiteCount: number, returnValueUsed: boolean): boolean {
        if (!this.opts.allowSafeZeroK) return false;
        if (returnValueUsed) return false;
        if (fanIn > this.opts.zeroKFanInThreshold) return false;
        if (callSiteCount > this.opts.zeroKMaxCallSites) return false;
        return true;
    }

    private applyConflictRefinement(methodNames: string[], minK: number): void {
        const refinedK = Math.max(1, minK);
        for (const methodName of methodNames) {
            if (!this.selectedKByMethodName.has(methodName)) continue;
            const oldK = this.selectedKByMethodName.get(methodName)!;
            if (oldK >= refinedK) continue;
            this.selectedKByMethodName.set(methodName, refinedK);
            this.conflictRefinedMethods.add(methodName);
        }
    }
}
