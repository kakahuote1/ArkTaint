import { Scene } from "../../../../../arkanalyzer/out/src/Scene";
import { collectFiniteStringCandidatesFromValue } from "../../../substrate/queries/FiniteStringCandidateResolver";
import { isSdkBackedMethodSignature } from "../../../substrate/queries/SdkProvenance";
import { resolveCallbackRegistrationsFromStmt } from "../../../substrate/queries/CallbackBindingQuery";
import {
    CallbackRegistrationMatch,
    FrameworkCallbackResolutionPolicy,
    resolveKnownChannelCallbackRegistration,
    resolveKnownControllerOptionCallbackRegistrationsFromStmt,
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
};

export function collectCallbackFacts(scene: Scene, context: ArkMainFactCollectionContext): void {
    const initialCandidateMethods = dedupeMethods([
        ...context.explicitSeedMethods,
        ...context.phaseCandidateMethods.get("bootstrap")!,
        ...context.phaseCandidateMethods.get("composition")!,
        ...context.phaseCandidateMethods.get("interaction")!,
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
        for (const stmt of [
            ...cfg.getStmts(),
            ...collectDeclaringClassInitializerStmts(method),
        ]) {
            if (!stmt?.getInvokeExpr?.()) continue;
            const callbackBindings = resolveCallbackRegistrationsFromStmt(
                stmt,
                scene,
                method,
                (args) =>
                    isAuditedArkMainUnregistrationCallback(args)
                        ? null
                        : resolveArkMainSdkRegisteredCallback(args)
                    || resolveArkMainFrameworkCallbackRegistrationWithPolicy(
                        args,
                        ARK_MAIN_DECLARATION_CALLBACK_POLICY,
                    )
                    || resolveKnownChannelCallbackRegistration(args),
                { maxDepth: 2 },
            );
            const optionBindings = resolveKnownControllerOptionCallbackRegistrationsFromStmt(stmt, scene, method);
            for (const binding of [...callbackBindings, ...optionBindings]) {
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
                    entryFamily: resolveArkMainCallbackEntryFamily(binding.recognitionLayer, binding.slotFamily),
                    entryShape: binding.registrationShape,
                    recognitionLayer: binding.recognitionLayer,
                });
                const addedNewFact = context.facts.length > factCountBefore;
                if (
                    shouldArkMainQueueOpaqueExternalCallback(binding, addedNewFact, callbackSignature, queuedSignatures)
                    || shouldQueueKnownOptionCallback(binding, addedNewFact, callbackSignature, queuedSignatures)
                ) {
                    queuedSignatures.add(callbackSignature);
                    context.phaseByMethodSignature.set(callbackSignature, "interaction");
                    pendingMethods.push(binding.callbackMethod);
                }
            }
        }
    }
}

function collectDeclaringClassInitializerStmts(method: any): any[] {
    const cls = method?.getDeclaringArkClass?.();
    const fields = cls?.getFields?.() || [];
    const out: any[] = [];
    for (const field of fields) {
        const initializer = field?.getInitializer?.();
        if (Array.isArray(initializer)) {
            out.push(...initializer);
        } else if (initializer) {
            out.push(initializer);
        }
    }
    return out;
}

function shouldQueueKnownOptionCallback(
    binding: { recognitionLayer?: string },
    addedNewFact: boolean,
    callbackSignature: string | undefined,
    queuedSignatures: ReadonlySet<string>,
): boolean {
    return !!(
        addedNewFact
        && (binding.recognitionLayer === "controller_options" || binding.recognitionLayer === "component_options")
        && callbackSignature
        && !queuedSignatures.has(callbackSignature)
    );
}

function resolveArkMainFrameworkCallbackRegistrationWithPolicy(
    args: {
        invokeExpr: any;
        explicitArgs: any[];
        scene: Scene;
        sourceMethod: any;
    },
    policy: FrameworkCallbackResolutionPolicy,
): CallbackRegistrationMatch | null {
    if (isAuditedArkMainUnregistrationCallback(args)) {
        return null;
    }
    return resolveKnownFrameworkCallbackRegistrationWithPolicy(args, policy);
}

function isAuditedArkMainUnregistrationCallback(args: {
    invokeExpr: any;
    explicitArgs: any[];
    scene: Scene;
    sourceMethod: any;
}): boolean {
    const methodSig = args.invokeExpr?.getMethodSignature?.();
    if (!methodSig || !isSdkBackedMethodSignature(args.scene, methodSig, {
        sourceMethod: args.sourceMethod,
        invokeExpr: args.invokeExpr,
    })) {
        return false;
    }

    const ownerName = methodSig.getDeclaringClassSignature?.()?.getClassName?.() || "";
    const methodName = methodSig.getMethodSubSignature?.()?.getMethodName?.() || "";
    if (methodName !== "off") {
        return false;
    }

    const eventNames = collectFiniteStringCandidatesFromValue(args.scene, args.explicitArgs?.[0]);
    if (ownerName === "ApplicationContext") {
        return eventNames.length === 1
            && (eventNames[0] === "abilityLifecycle" || eventNames[0] === "environment");
    }
    if (ownerName === "Caller") {
        return eventNames.length === 1 && eventNames[0] === "release";
    }
    return false;
}

function resolveArkMainSdkRegisteredCallback(args: {
    invokeExpr: any;
    explicitArgs: any[];
    scene: Scene;
    sourceMethod: any;
}): CallbackRegistrationMatch | null {
    const invokeExpr = args.invokeExpr;
    const methodSig = invokeExpr?.getMethodSignature?.();
    if (!methodSig || !isSdkBackedMethodSignature(args.scene, methodSig, {
        sourceMethod: args.sourceMethod,
        invokeExpr,
    })) {
        return null;
    }

    const ownerName = methodSig.getDeclaringClassSignature?.()?.getClassName?.() || "";
    const methodName = methodSig.getMethodSubSignature?.()?.getMethodName?.() || "";

    if (ownerName === "ApplicationContext" && methodName === "on") {
        return resolveApplicationContextObserverRegistration(args);
    }
    if (ownerName === "Caller" && methodName === "onRelease") {
        return {
            callbackArgIndexes: [0],
            reason: "SDK ArkMain Caller.onRelease callback registration",
            callbackFlavor: "channel",
            registrationShape: "direct_callback_slot",
            slotFamily: "system_direct_slot",
            recognitionLayer: "sdk_provenance",
        };
    }
    if (ownerName === "Caller" && methodName === "on") {
        const eventNames = collectFiniteStringCandidatesFromValue(args.scene, args.explicitArgs?.[0]);
        if (eventNames.length === 1 && eventNames[0] === "release") {
            return {
                callbackArgIndexes: [1],
                reason: "SDK ArkMain Caller.on('release') callback registration",
                callbackFlavor: "channel",
                registrationShape: "string_plus_callback_slot",
                slotFamily: "subscription_event_slot",
                recognitionLayer: "sdk_provenance",
            };
        }
    }

    return null;
}

function resolveApplicationContextObserverRegistration(args: {
    explicitArgs: any[];
    scene: Scene;
}): CallbackRegistrationMatch | null {
    const eventNames = collectFiniteStringCandidatesFromValue(args.scene, args.explicitArgs?.[0]);
    if (eventNames.length !== 1) {
        return null;
    }
    if (eventNames[0] === "abilityLifecycle") {
        return {
            callbackArgIndexes: [1],
            callbackFieldNames: [
                "onNewWant",
                "onWindowStageCreate",
                "onWindowStageDestroy",
                "onWindowStageRestore",
                "onWindowStageWillDestroy",
            ],
            reason: "SDK ArkMain ApplicationContext.on('abilityLifecycle') observer registration",
            callbackFlavor: "channel",
            registrationShape: "string_plus_callback_slot",
            slotFamily: "subscription_event_slot",
            recognitionLayer: "sdk_provenance",
        };
    }
    if (eventNames[0] === "environment") {
        return {
            callbackArgIndexes: [1],
            callbackFieldNames: ["onMemoryLevel"],
            reason: "SDK ArkMain ApplicationContext.on('environment') observer registration",
            callbackFlavor: "channel",
            registrationShape: "string_plus_callback_slot",
            slotFamily: "subscription_event_slot",
            recognitionLayer: "sdk_provenance",
        };
    }
    return null;
}

