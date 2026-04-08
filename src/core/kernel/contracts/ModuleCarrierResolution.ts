import { Local } from "../../../../arkanalyzer/lib/core/base/Local";
import { Pag } from "../../../../arkanalyzer/lib/callgraph/pointerAnalysis/Pag";
import { collectAliasLocalsForCarrier as collectAliasLocalsForCarrierFromOrdinary } from "../ordinary/OrdinaryAliasPropagation";

export function collectAliasLocalsForCarrier(
    pag: Pag,
    carrierNodeId: number,
): Local[] {
    return collectAliasLocalsForCarrierFromOrdinary(pag, carrierNodeId);
}
