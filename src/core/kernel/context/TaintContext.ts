/**
 * TaintContext - ArkTaint 鐨勮皟鐢ㄧ偣涓婁笅鏂囩鐞嗗櫒
 * 
 * 锟?ArkTaint 姹＄偣浼犳挱灞傜鐞嗕笂涓嬫枃淇℃伅锛屽锟?Arkanalyzer 锟?Context 鏁版嵁缁撴瀯锟?
 * PAG 灞備繚锟?k=0 涓嶅彉锛屼笂涓嬫枃鏁忔劅浠呭湪 TaintFact 灞傚疄鐜帮拷?
 */

import { CallSiteContext, Context, ContextCache, ContextID, DUMMY_CID } from '../../../../arkanalyzer/lib/callgraph/pointerAnalysis/context/Context';
import { ContextItemManager } from '../../../../arkanalyzer/lib/callgraph/pointerAnalysis/context/ContextItem';

export type ContextKSelector = (callerMethodName: string, calleeMethodName: string, defaultK: number) => number;

/**
 * 璋冪敤杈逛俊鎭細璁板綍 PAG 涓竴锟?Copy 杈规槸鍙傛暟浼犻€掞紙Call锛夎繕鏄繑鍥炲€间紶閫掞紙Return锟?
 */
export enum CallEdgeType {
    CALL,    // 鍙傛暟浼犻€掞細caller arg 锟?callee param
    RETURN,  // 杩斿洖鍊间紶閫掞細callee ret 锟?caller dst
}

/**
 * 璁板綍涓€鏉¤法鍑芥暟 Copy 杈圭殑涓婁笅鏂囦俊锟?
 * srcNodeId 锟?dstNodeId 锟?Copy 杈癸紝绫诲瀷锟?CALL 锟?RETURN
 */
export interface CallEdgeInfo {
    type: CallEdgeType;
    callSiteId: number;      // 鐢ㄤ簬鐢熸垚涓婁笅鏂囩殑 CallSite 鏍囪瘑
    callerMethodName: string; // caller 鏂规硶鍚嶏紙鐢ㄤ簬璋冭瘯锟?
    calleeMethodName: string; // callee 鏂规硶鍚嶏紙鐢ㄤ簬璋冭瘯锟?
}

/**
 * ArkTaint 鐨勪笂涓嬫枃绠＄悊锟?
 * 鍩轰簬 CallSite 锟?k-limited 涓婁笅锟?
 */
export class TaintContextManager {
    private contextCache: ContextCache;
    private ctxItemManager: ContextItemManager;
    private k: number;
    private contextKSelector?: ContextKSelector;

    // 绌轰笂涓嬫枃锟?ID锛堢紦瀛橈級
    private emptyCID: ContextID;

    constructor(k: number = 1) {
        this.k = k;
        this.contextCache = new ContextCache();
        this.ctxItemManager = new ContextItemManager();

        // 鍒涘缓骞剁紦瀛樼┖涓婁笅锟?
        let emptyCtx = CallSiteContext.newEmpty();
        this.emptyCID = this.contextCache.getOrNewContextID(emptyCtx);
    }

    public setContextKSelector(selector?: ContextKSelector): void {
        this.contextKSelector = selector;
    }

    /**
     * 鑾峰彇绌轰笂涓嬫枃 ID锛堝叆鍙ｅ嚱鏁板拰鍒濆绉嶅瓙浣跨敤锟?
     */
    public getEmptyContextID(): ContextID {
        return this.emptyCID;
    }

    /**
     * 鍒涘缓 callee 涓婁笅锟?
     * 锟?Call 杈逛紶鎾椂璋冪敤锛氬皢 callSiteId 杩藉姞锟?caller 涓婁笅鏂囦腑
     * @param callerCtxID caller 鐨勪笂涓嬫枃 ID
     * @param callSiteId 璋冪敤鐐规爣璇嗭紙浣跨敤 PAG 锟?src 鑺傜偣 ID 浣滀负鍞竴鏍囪瘑锟?
     * @returns callee 鐨勪笂涓嬫枃 ID
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

        // 鐩存帴鏋勶拷?k-limited 涓婁笅鏂囷細锟?callSiteId 鍘嬪叆鏍堥《
        // 涓嶄娇锟?Context.append()锛屽洜涓哄畠浼氶€氳繃 ContextItemManager 鍒嗛厤鑷 ID
        let newElems: number[] = [callSiteId];

        if (callerCtx && callerCtx.length() > 0) {
            // 鍙栧墠 k-1 涓厓绱狅紙k-limited 绛栫暐锟?
            let oldLen = Math.min(callerCtx.length(), effectiveK - 1);
            for (let i = 0; i < oldLen; i++) {
                newElems.push(callerCtx.get(i));
            }
        }

        let calleeCtx = CallSiteContext.new(newElems);
        return this.contextCache.getOrNewContextID(calleeCtx);
    }

    /**
     * 鎭㈠ caller 涓婁笅锟?
     * 锟?Return 杈逛紶鎾椂璋冪敤锛氫粠 callee 涓婁笅鏂囦腑鎻愬彇 caller 涓婁笅锟?
     * 瀵逛簬 k-limited 涓婁笅鏂囷紝callee 涓婁笅锟?= [cs_n, cs_n-1, ..., cs_1]
     * caller 涓婁笅锟?= [cs_n-1, ..., cs_1]锛堝脊鍑烘渶杩戠殑 callsite锟?
     * @param calleeCtxID callee 鐨勪笂涓嬫枃 ID  
     * @returns caller 鐨勪笂涓嬫枃 ID
     */
    public restoreCallerContext(calleeCtxID: ContextID): ContextID {
        if (this.k === 0) {
            return this.emptyCID;
        }

        let calleeCtx = this.contextCache.getContext(calleeCtxID);
        if (!calleeCtx || calleeCtx.length() === 0) {
            return this.emptyCID;
        }

        // 寮瑰嚭鏈€杩戠殑 callsite 鍏冪礌锛屾瀯锟?caller 涓婁笅锟?
        let callerElems: number[] = [];
        for (let i = 1; i < calleeCtx.length(); i++) {
            callerElems.push(calleeCtx.get(i));
        }

        let callerCtx = CallSiteContext.new(callerElems);
        return this.contextCache.getOrNewContextID(callerCtx);
    }

    /**
     * 鑾峰彇涓婁笅鏂囩殑鏍堥《鍏冪礌锛堟渶杩戠殑 callsite ID锟?
     * 鐢ㄤ簬 Return 杈圭殑涓婁笅鏂囧尮锟?
     * @returns 鏍堥《 callSiteId锛屽鏋滀笂涓嬫枃涓虹┖鍒欒繑锟?-1
     */
    public getTopElement(ctxID: ContextID): number {
        let ctx = this.contextCache.getContext(ctxID);
        if (!ctx || ctx.length() === 0) return -1;
        return ctx.get(0);
    }

    /**
     * 鑾峰彇涓婁笅鏂囧瓧绗︿覆锛堢敤锟?TaintFact ID 璁＄畻锟?
     */
    public getContextString(ctxID: ContextID): string {
        let ctx = this.contextCache.getContext(ctxID);
        if (!ctx) return '';
        return ctx.toString();
    }

    /**
     * 鑾峰彇 k 锟?
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
