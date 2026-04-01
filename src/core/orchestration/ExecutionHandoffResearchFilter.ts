import {
    DeferredHandoffMode,
} from "./ExecutionHandoffModes";
import type { ExecutionHandoffContractRecord } from "../kernel/handoff/ExecutionHandoffContract";

export function filterExecutionHandoffContractsForMode(
    mode: DeferredHandoffMode,
    records: ExecutionHandoffContractRecord[],
): ExecutionHandoffContractRecord[] {
    if (mode !== "paper_like") {
        return records;
    }
    return records.filter(record => isPaperLikeContract(record));
}

function isPaperLikeContract(record: ExecutionHandoffContractRecord): boolean {
    if (record.activationLabel !== "register") {
        return false;
    }
    if (record.registrationReachabilityDepth !== 0) {
        return false;
    }
    if (record.matchingArgIndexes.length === 0) {
        return false;
    }
    if (record.carrierKind !== "direct") {
        return false;
    }
    return true;
}
