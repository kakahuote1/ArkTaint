import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import { Pag } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { collectAliasLocalsForCarrier as collectAliasLocalsForCarrierFromOrdinary } from "../ordinary/OrdinaryAliasPropagation";

export function collectAliasLocalsForCarrier(
    pag: Pag,
    carrierNodeId: number,
): Local[] {
    return collectAliasLocalsForCarrierFromOrdinary(pag, carrierNodeId);
}
