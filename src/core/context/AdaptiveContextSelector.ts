import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { CallGraph } from "../../../arkanalyzer/out/src/callgraph/model/CallGraph";

export interface AdaptiveContextSelectorOptions {
    lowK?: number;
    highK?: number;
    veryHighK?: number;
    highFanInThreshold?: number;
    veryHighFanInThreshold?: number;
}

interface SelectorStats {
    methodName: string;
    fanIn: number;
    selectedK: number;
}

/**
 * v1: 基于调用图扇入度的自适应 k 选择器。
 * 说明：当前阶段仅启用 {1,2} 分层，避免破坏 return 上下文匹配语义。
 */
export class AdaptiveContextSelector {
    private readonly opts: Required<AdaptiveContextSelectorOptions>;
    private readonly fanInByMethodName: Map<string, number> = new Map();
    private readonly selectedKByMethodName: Map<string, number> = new Map();

    constructor(scene: Scene, cg: CallGraph, options: AdaptiveContextSelectorOptions = {}) {
        this.opts = {
            lowK: Math.max(1, options.lowK ?? 1),
            highK: Math.max(1, options.highK ?? 2),
            veryHighK: Math.max(1, options.veryHighK ?? 2),
            highFanInThreshold: Math.max(1, options.highFanInThreshold ?? 3),
            veryHighFanInThreshold: Math.max(1, options.veryHighFanInThreshold ?? 6),
        };
        this.preAnalyze(scene, cg);
    }

    public selectK(callerMethodName: string, calleeMethodName: string, defaultK: number): number {
        const selected = this.selectedKByMethodName.get(calleeMethodName);
        if (selected === undefined) {
            return Math.max(1, defaultK);
        }
        return selected;
    }

    public getSummary(): string {
        const stats = this.getStats();
        const high = stats.filter(s => s.selectedK >= this.opts.highK).length;
        const veryHigh = stats.filter(s => s.selectedK >= this.opts.veryHighK && s.fanIn >= this.opts.veryHighFanInThreshold).length;
        return `methods=${stats.length}, highK=${high}, veryHighK=${veryHigh}, thresholds=[${this.opts.highFanInThreshold},${this.opts.veryHighFanInThreshold}]`;
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
            stats.push({ methodName, fanIn, selectedK });
        }
        return stats;
    }

    private preAnalyze(scene: Scene, cg: CallGraph): void {
        const callerSetByCalleeName: Map<string, Set<string>> = new Map();

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
                }
            }
        }

        for (const method of scene.getMethods()) {
            const methodName = method.getName();
            const fanIn = callerSetByCalleeName.get(methodName)?.size ?? 0;
            this.fanInByMethodName.set(methodName, fanIn);
            this.selectedKByMethodName.set(methodName, this.decideK(fanIn));
        }
    }

    private decideK(fanIn: number): number {
        if (fanIn >= this.opts.veryHighFanInThreshold) {
            return this.opts.veryHighK;
        }
        if (fanIn >= this.opts.highFanInThreshold) {
            return this.opts.highK;
        }
        return this.opts.lowK;
    }
}
