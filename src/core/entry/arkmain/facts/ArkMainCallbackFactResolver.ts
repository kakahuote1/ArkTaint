import { Scene } from "../../../../../arkanalyzer/out/src/Scene";
import { resolveCallbackRegistrationsFromStmt } from "../../../substrate/queries/CallbackBindingQuery";
import {
    FrameworkCallbackResolutionPolicy,
    isKnownSchedulerMethodName,
    resolveKnownChannelCallbackRegistration,
    resolveKnownFrameworkCallbackRegistrationWithPolicy,
} from "../../shared/FrameworkCallbackClassifier";
import { ArkMainFactCollectionContext } from "./ArkMainFactContext";
import { dedupeMethods } from "./ArkMainFactResolverUtils";

const ARK_MAIN_DECLARATION_CALLBACK_POLICY: FrameworkCallbackResolutionPolicy = {
    enableSdkProvenance: true,
    enableOpaqueExternalCallFallback: true,
    enableOwnerQualifiedFallback: false,
    enableEmptyOwnerFallback: false,
    enableStructuralCallableFallback: false,
};

export function collectCallbackFacts(scene: Scene, context: ArkMainFactCollectionContext): void {
    const initialCandidateMethods = dedupeMethods([
        ...context.explicitSeedMethods,
        ...context.phaseCandidateMethods.get("bootstrap")!,
        ...context.phaseCandidateMethods.get("composition")!,
        ...context.phaseCandidateMethods.get("reactive_handoff")!,
        ...context.phaseCandidateMethods.get("teardown")!,
    ]);
    const pendingMethods = [...initialCandidateMethods];
    const queuedSignatures = new Set(
        initialCandidateMethods
            .map(method => method.getSignature?.()?.toString?.())
            .filter((signature): signature is string => !!signature),
    );
    const scannedSignatures = new Set<string>();

    while (pendingMethods.length > 0) {
        const method = pendingMethods.shift()!;
        const methodSignature = method.getSignature?.()?.toString?.();
        if (!methodSignature || scannedSignatures.has(methodSignature)) {
            continue;
        }
        scannedSignatures.add(methodSignature);
        const cfg = method.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            if (!stmt?.getInvokeExpr?.()) continue;
            const callbackBindings = resolveCallbackRegistrationsFromStmt(
                stmt,
                scene,
                method,
                (args) =>
                    resolveKnownFrameworkCallbackRegistrationWithPolicy(
                        args,
                        ARK_MAIN_DECLARATION_CALLBACK_POLICY,
                    )
                    || resolveKnownChannelCallbackRegistration(args),
                { maxDepth: 2 },
            );
            for (const binding of callbackBindings) {
                if (isKnownSchedulerMethodName(binding.registrationMethodName)) {
                    continue;
                }
                const sourceSignature = binding.sourceMethod?.getSignature?.()?.toString?.();
                const sourcePhase = sourceSignature ? context.phaseByMethodSignature.get(sourceSignature) : undefined;
                const callbackFlavor = binding.callbackFlavor || "channel";
                if (callbackFlavor === "ui_event" && sourcePhase !== "composition") {
                    continue;
                }
                const callbackSignature = binding.callbackMethod?.getSignature?.()?.toString?.();
                const factCountBefore = context.facts.length;
                context.addFact({
                    phase: "interaction",
                    kind: "callback",
                    method: binding.callbackMethod,
                    reason: binding.reason,
                    sourceMethod: binding.sourceMethod,
                    callbackFlavor,
                    callbackShape: binding.registrationShape,
                    callbackSlotFamily: binding.slotFamily,
                    callbackRecognitionLayer: binding.recognitionLayer,
                    callbackRegistrationSignature: binding.registrationSignature,
                    callbackArgIndex: binding.callbackArgIndex,
                    callbackStructuralEvidenceFamily: binding.structuralEvidenceFamily,
                    entryFamily: resolveOpenCallbackEntryFamily(binding.recognitionLayer, binding.slotFamily),
                    entryShape: binding.registrationShape,
                    recognitionLayer: binding.recognitionLayer,
                });
                const addedNewFact = context.facts.length > factCountBefore;
                if (
                    addedNewFact
                    && binding.recognitionLayer === "opaque_external_call_fallback"
                    && callbackSignature
                    && !queuedSignatures.has(callbackSignature)
                ) {
                    queuedSignatures.add(callbackSignature);
                    context.phaseByMethodSignature.set(callbackSignature, "interaction");
                    pendingMethods.push(binding.callbackMethod);
                }
            }
        }
    }
}

function resolveOpenCallbackEntryFamily(
    recognitionLayer: string | undefined,
    slotFamily: string | undefined,
): string | undefined {
    if (slotFamily) {
        return undefined;
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

