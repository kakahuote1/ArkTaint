import { ArkMethod } from "../../../../../arkanalyzer/out/src/core/model/ArkMethod";
import { isKnownSchedulerMethodName } from "../../shared/FrameworkCallbackClassifier";
import type { ArkMainEntryFact, ArkMainPhaseName } from "../ArkMainTypes";

const ARK_MAIN_DEFERRED_CONTINUATION_METHOD_NAMES = new Set([
    "then",
    "catch",
    "finally",
]);

const ARK_MAIN_OPEN_WORLD_CALLBACK_ENTRY_FAMILIES = new Set([
    "unknown_sdk_callback",
    "unknown_external_callback",
    "unknown_structural_callback",
]);

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
    return ARK_MAIN_DEFERRED_CONTINUATION_METHOD_NAMES.has(String(methodName || ""));
}

export function resolveArkMainCallbackEntryFamily(
    recognitionLayer: string | undefined,
    slotFamily: string | undefined,
): string | undefined {
    if (slotFamily) {
        return slotFamily;
    }
    if (recognitionLayer === "sdk_provenance") {
        return "unknown_sdk_callback";
    }
    if (recognitionLayer === "opaque_external_call_fallback") {
        return "unknown_external_callback";
    }
    if (recognitionLayer === "structural_callable_fallback") {
        return "unknown_structural_callback";
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
    binding: ArkMainCallbackBindingLike,
    addedNewFact: boolean,
    callbackSignature: string | undefined,
    queuedSignatures: ReadonlySet<string>,
): boolean {
    return !!(
        addedNewFact
        && binding.recognitionLayer === "opaque_external_call_fallback"
        && callbackSignature
        && !queuedSignatures.has(callbackSignature)
    );
}

export function isArkMainOpenWorldCallbackEntryFamily(entryFamily: string | undefined): boolean {
    return ARK_MAIN_OPEN_WORLD_CALLBACK_ENTRY_FAMILIES.has(String(entryFamily || ""));
}

export function shouldArkMainAutoHintCallbackFact(
    fact: Pick<ArkMainEntryFact, "kind" | "entryFamily" | "callbackSlotFamily" | "callbackRegistrationSignature" | "callbackArgIndex">,
): boolean {
    if (fact.kind !== "callback") {
        return false;
    }
    if (!isArkMainOpenWorldCallbackEntryFamily(fact.entryFamily)) {
        return false;
    }
    if (fact.callbackSlotFamily) {
        return false;
    }
    if (!fact.callbackRegistrationSignature || fact.callbackArgIndex === undefined) {
        return false;
    }
    if (
        fact.callbackRegistrationSignature.includes("NavDestination.register")
        || fact.callbackRegistrationSignature.includes("NavDestination.setBuilder")
        || fact.callbackRegistrationSignature.includes("NavDestination.setDestinationBuilder")
    ) {
        return false;
    }
    return !ARK_MAIN_DEFERRED_CONTINUATION_METHOD_NAMES.has(
        extractRegistrationMethodNameFromSignature(fact.callbackRegistrationSignature),
    );
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

function extractRegistrationMethodNameFromSignature(signature: string): string {
    const trimmed = String(signature || "");
    const open = trimmed.lastIndexOf(".");
    const close = trimmed.indexOf("(", open >= 0 ? open : 0);
    if (open < 0 || close < 0 || close <= open + 1) {
        return "";
    }
    return trimmed.slice(open + 1, close);
}
