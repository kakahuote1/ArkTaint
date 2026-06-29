import { ArkMethod } from "../../../../../arkanalyzer/out/src/core/model/ArkMethod";
import { isKnownSchedulerMethodName } from "../../shared/FrameworkCallbackClassifier";
import type { ArkMainEntryFact, ArkMainPhaseName } from "../ArkMainTypes";

interface ArkMainCallbackBindingLike {
    registrationMethodName?: string;
    callbackFlavor?: string;
    recognitionLayer?: string;
    callbackMethod?: ArkMethod;
    callbackSlotFamily?: string;
}

interface ArkMainDeferredReachableContractLike {
    activation: string;
}

export function isArkMainDeferredContinuationRegistrationName(methodName: string | undefined): boolean {
    void methodName;
    return false;
}

export function resolveArkMainCallbackEntryFamily(
    _recognitionLayer: string | undefined,
    slotFamily: string | undefined,
): string | undefined {
    if (slotFamily) {
        return slotFamily;
    }
    return undefined;
}

export function shouldArkMainPromoteCallbackBinding(
    binding: ArkMainCallbackBindingLike,
    sourcePhase: ArkMainPhaseName | undefined,
): boolean {
    if (isKnownSchedulerMethodName(binding.registrationMethodName)) {
        return false;
    }
    if (isArkMainDeferredContinuationRegistrationName(binding.registrationMethodName)) {
        return false;
    }
    const callbackFlavor = binding.callbackFlavor || "channel";
    if (callbackFlavor === "ui_event" && sourcePhase !== "composition") {
        return false;
    }
    return true;
}

export function shouldArkMainQueueOpaqueExternalCallback(
    _binding: ArkMainCallbackBindingLike,
    _addedNewFact: boolean,
    _callbackSignature: string | undefined,
    _queuedSignatures: ReadonlySet<string>,
): boolean {
    return false;
}

export function isArkMainOpenWorldCallbackEntryFamily(_entryFamily: string | undefined): boolean {
    return false;
}

export function shouldArkMainAutoHintCallbackFact(
    fact: Pick<ArkMainEntryFact, "kind" | "entryFamily" | "callbackSlotFamily" | "callbackRegistrationSignature" | "callbackArgIndex">,
): boolean {
    void fact;
    return false;
}

export function shouldArkMainIncludeDeferredContractInReachable(
    entryModel: "arkMain" | "explicit",
    contract: ArkMainDeferredReachableContractLike,
): boolean {
    if (entryModel !== "arkMain") {
        return true;
    }
    return !contract.activation.startsWith("settle(");
}
