import { Scene } from "../../../../../arkanalyzer/lib/Scene";
import { resolveCallbackRegistrationsFromStmt } from "../../../substrate/queries/CallbackBindingQuery";
import {
    FrameworkCallbackResolutionPolicy,
    resolveKnownChannelCallbackRegistration,
    resolveKnownFrameworkCallbackRegistrationWithPolicy,
} from "../../shared/FrameworkCallbackClassifier";
import { ArkMainFactCollectionContext } from "./ArkMainFactContext";
import { dedupeMethods } from "./ArkMainFactResolverUtils";
import {
    resolveArkMainCallbackEntryFamily,
    shouldArkMainPromoteCallbackBinding,
    shouldArkMainQueueOpaqueExternalCallback,
} from "./ArkMainFrameworkCallbackBoundary";

const ARK_MAIN_DECLARATION_CALLBACK_POLICY: FrameworkCallbackResolutionPolicy = {
    enableSdkProvenance: true,
    enableOpaqueExternalCallFallback: true,
    enableOwnerQualifiedFallback: true,
    enableEmptyOwnerFallback: true,
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

    for (let head = 0; head < pendingMethods.length; head++) {
        const method = pendingMethods[head];
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
                const sourceSignature = binding.sourceMethod?.getSignature?.()?.toString?.();
                const sourcePhase = sourceSignature ? context.phaseByMethodSignature.get(sourceSignature) : undefined;
                if (!shouldArkMainPromoteCallbackBinding(binding, sourcePhase)) {
                    continue;
                }
                const callbackFlavor = binding.callbackFlavor || "channel";
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
                    entryFamily: resolveArkMainCallbackEntryFamily(binding.recognitionLayer, binding.slotFamily),
                    entryShape: binding.registrationShape,
                    recognitionLayer: binding.recognitionLayer,
                });
                const addedNewFact = context.facts.length > factCountBefore;
                if (shouldArkMainQueueOpaqueExternalCallback(binding, addedNewFact, callbackSignature, queuedSignatures)) {
                    queuedSignatures.add(callbackSignature);
                    context.phaseByMethodSignature.set(callbackSignature, "interaction");
                    pendingMethods.push(binding.callbackMethod);
                }
            }
        }
    }
}

