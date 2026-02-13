/**
 * TaintContext - ArkTaint 的调用点上下文管理器
 * 
 * 在 ArkTaint 污点传播层管理上下文信息，复用 Arkanalyzer 的 Context 数据结构。
 * PAG 层保持 k=0 不变，上下文敏感仅在 TaintFact 层实现。
 */

import { CallSiteContext, Context, ContextCache, ContextID, DUMMY_CID } from '../../../arkanalyzer/out/src/callgraph/pointerAnalysis/context/Context';
import { ContextItemManager } from '../../../arkanalyzer/out/src/callgraph/pointerAnalysis/context/ContextItem';

export type ContextKSelector = (callerMethodName: string, calleeMethodName: string, defaultK: number) => number;

/**
 * 调用边信息：记录 PAG 中一条 Copy 边是参数传递（Call）还是返回值传递（Return）
 */
export enum CallEdgeType {
    CALL,    // 参数传递：caller arg → callee param
    RETURN,  // 返回值传递：callee ret → caller dst
}

/**
 * 记录一条跨函数 Copy 边的上下文信息
 * srcNodeId → dstNodeId 的 Copy 边，类型为 CALL 或 RETURN
 */
export interface CallEdgeInfo {
    type: CallEdgeType;
    callSiteId: number;      // 用于生成上下文的 CallSite 标识
    callerMethodName: string; // caller 方法名（用于调试）
    calleeMethodName: string; // callee 方法名（用于调试）
}

/**
 * ArkTaint 的上下文管理器
 * 基于 CallSite 的 k-limited 上下文
 */
export class TaintContextManager {
    private contextCache: ContextCache;
    private ctxItemManager: ContextItemManager;
    private k: number;
    private contextKSelector?: ContextKSelector;

    // 空上下文的 ID（缓存）
    private emptyCID: ContextID;

    constructor(k: number = 1) {
        this.k = k;
        this.contextCache = new ContextCache();
        this.ctxItemManager = new ContextItemManager();

        // 创建并缓存空上下文
        let emptyCtx = CallSiteContext.newEmpty();
        this.emptyCID = this.contextCache.getOrNewContextID(emptyCtx);
    }

    public setContextKSelector(selector?: ContextKSelector): void {
        this.contextKSelector = selector;
    }

    /**
     * 获取空上下文 ID（入口函数和初始种子使用）
     */
    public getEmptyContextID(): ContextID {
        return this.emptyCID;
    }

    /**
     * 创建 callee 上下文
     * 在 Call 边传播时调用：将 callSiteId 追加到 caller 上下文中
     * @param callerCtxID caller 的上下文 ID
     * @param callSiteId 调用点标识（使用 PAG 中 src 节点 ID 作为唯一标识）
     * @returns callee 的上下文 ID
     */
    public createCalleeContext(
        callerCtxID: ContextID,
        callSiteId: number,
        callerMethodName?: string,
        calleeMethodName?: string
    ): ContextID {
        if (this.k === 0 && !this.contextKSelector) {
            return this.emptyCID;
        }

        const effectiveK = this.resolveEffectiveK(callerMethodName, calleeMethodName);
        if (effectiveK <= 0) {
            return this.emptyCID;
        }

        let callerCtx = this.contextCache.getContext(callerCtxID);

        // 直接构造 k-limited 上下文：将 callSiteId 压入栈顶
        // 不使用 Context.append()，因为它会通过 ContextItemManager 分配自增 ID
        let newElems: number[] = [callSiteId];

        if (callerCtx && callerCtx.length() > 0) {
            // 取前 k-1 个元素（k-limited 策略）
            let oldLen = Math.min(callerCtx.length(), effectiveK - 1);
            for (let i = 0; i < oldLen; i++) {
                newElems.push(callerCtx.get(i));
            }
        }

        let calleeCtx = CallSiteContext.new(newElems);
        return this.contextCache.getOrNewContextID(calleeCtx);
    }

    /**
     * 恢复 caller 上下文
     * 在 Return 边传播时调用：从 callee 上下文中提取 caller 上下文
     * 对于 k-limited 上下文，callee 上下文 = [cs_n, cs_n-1, ..., cs_1]
     * caller 上下文 = [cs_n-1, ..., cs_1]（弹出最近的 callsite）
     * @param calleeCtxID callee 的上下文 ID  
     * @returns caller 的上下文 ID
     */
    public restoreCallerContext(calleeCtxID: ContextID): ContextID {
        if (this.k === 0) {
            return this.emptyCID;
        }

        let calleeCtx = this.contextCache.getContext(calleeCtxID);
        if (!calleeCtx || calleeCtx.length() === 0) {
            return this.emptyCID;
        }

        // 弹出最近的 callsite 元素，构建 caller 上下文
        let callerElems: number[] = [];
        for (let i = 1; i < calleeCtx.length(); i++) {
            callerElems.push(calleeCtx.get(i));
        }

        let callerCtx = CallSiteContext.new(callerElems);
        return this.contextCache.getOrNewContextID(callerCtx);
    }

    /**
     * 获取上下文的栈顶元素（最近的 callsite ID）
     * 用于 Return 边的上下文匹配
     * @returns 栈顶 callSiteId，如果上下文为空则返回 -1
     */
    public getTopElement(ctxID: ContextID): number {
        let ctx = this.contextCache.getContext(ctxID);
        if (!ctx || ctx.length() === 0) return -1;
        return ctx.get(0);
    }

    /**
     * 获取上下文字符串（用于 TaintFact ID 计算）
     */
    public getContextString(ctxID: ContextID): string {
        let ctx = this.contextCache.getContext(ctxID);
        if (!ctx) return '';
        return ctx.toString();
    }

    /**
     * 获取 k 值
     */
    public getK(): number {
        return this.k;
    }

    private resolveEffectiveK(callerMethodName?: string, calleeMethodName?: string): number {
        let selected = this.k;
        if (this.contextKSelector && callerMethodName && calleeMethodName) {
            const dynamicK = this.contextKSelector(callerMethodName, calleeMethodName, this.k);
            if (Number.isFinite(dynamicK)) {
                selected = Math.max(0, Math.floor(dynamicK));
            }
        }
        return selected;
    }
}
