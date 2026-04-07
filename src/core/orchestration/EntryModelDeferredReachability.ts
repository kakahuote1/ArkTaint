interface DeferredReachableContractLike {
    activation: string;
}

export function shouldIncludeDeferredContractInReachable(
    entryModel: "arkMain" | "explicit",
    contract: DeferredReachableContractLike,
): boolean {
    if (entryModel !== "arkMain") {
        return true;
    }
    return !contract.activation.startsWith("settle(");
}
