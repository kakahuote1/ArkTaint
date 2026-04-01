import { Pag } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { TaintTracker } from "../model/TaintTracker";
import { propagateOrdinaryExpressionTaint } from "../ordinary/OrdinaryLanguagePropagation";

export function propagateExpressionTaint(
    nodeId: number,
    value: any,
    currentCtx: number,
    tracker: TaintTracker,
    pag: Pag,
    fieldPath?: string[],
): number[] {
    void nodeId;
    return propagateOrdinaryExpressionTaint(value, currentCtx, tracker, pag, fieldPath);
}
