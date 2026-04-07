import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { ArkMethod } from "../../../../arkanalyzer/out/src/core/model/ArkMethod";
import { collectFiniteStringCandidatesFromValue } from "../../substrate/queries/FiniteStringCandidateResolver";
import {
    CallbackRegistrationMatch,
    FrameworkResolvedCallbackRegistration,
    resolveKnownChannelCallbackRegistration,
    resolveKnownFrameworkCallbackRegistration,
    resolveKnownSchedulerCallbackRegistration,
    isKnownFrameworkCallbackMethodName,
    isKnownSchedulerMethodName,
} from "../../substrate/semantics/ApprovedImperativeDeferredBindingSemantics";
import {
    CallbackRegistrationMatchArgs,
    resolveCallbackRegistrationsFromStmt,
} from "../../substrate/queries/CallbackBindingQuery";

export {
    type CallbackRegistrationFlavor,
    type CallbackRegistrationShape,
    type CallbackRegistrationSlotFamily,
    type CallbackRegistrationRecognitionLayer,
    type CallbackRegistrationMatch,
    type FrameworkResolvedCallbackRegistration,
    resolveKnownFrameworkCallbackRegistration,
    resolveKnownSchedulerCallbackRegistration,
    resolveKnownChannelCallbackRegistration,
    isKnownFrameworkCallbackMethodName,
    isKnownSchedulerMethodName,
} from "../../substrate/semantics/ApprovedImperativeDeferredBindingSemantics";

export type KeyedCallbackDispatchRegistration = FrameworkResolvedCallbackRegistration & {
    familyId: string;
    dispatchKeys: string[];
};

interface ControllerOptionCallbackSpec {
    ownerClassNames: Set<string>;
    constructorMethodNames: Set<string>;
    optionsArgIndex: number;
    callbackFieldNames: Set<string>;
    reasonLabel: string;
}

interface KeyedCallbackDispatchFamilySpec {
    familyId: string;
    ownerClassNames: Set<string>;
    registrationMethodNames: Set<string>;
    dispatchMethodNames: Set<string>;
    callbackArgIndex: number;
    keyArgIndex: number;
}

const CONTROLLER_OPTION_CALLBACK_SPECS: ControllerOptionCallbackSpec[] = [
    {
        ownerClassNames: new Set(["CustomDialogController"]),
        constructorMethodNames: new Set(["constructor"]),
        optionsArgIndex: 0,
        callbackFieldNames: new Set(["builder", "cancel", "confirm"]),
        reasonLabel: "Framework controller callback registration",
    },
];

const KNOWN_KEYED_CALLBACK_DISPATCH_FAMILIES: KeyedCallbackDispatchFamilySpec[] = [
    {
        familyId: "nav_destination",
        ownerClassNames: new Set(["NavDestination"]),
        registrationMethodNames: new Set(["register", "setBuilder", "setDestinationBuilder"]),
        dispatchMethodNames: new Set(["trigger"]),
        callbackArgIndex: 1,
        keyArgIndex: 0,
    },
];

export function resolveKnownControllerOptionCallbackRegistrationsFromStmt(
    stmt: any,
    scene: Scene,
    sourceMethod: ArkMethod,
): FrameworkResolvedCallbackRegistration[] {
    const invokeExpr = stmt?.getInvokeExpr?.();
    if (!invokeExpr) return [];

    const methodSig = invokeExpr.getMethodSignature?.();
    const methodName = methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "";
    const className = methodSig?.getDeclaringClassSignature?.()?.getClassName?.() || "";
    const explicitArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
    const out = new Map<string, FrameworkResolvedCallbackRegistration>();

    for (const spec of CONTROLLER_OPTION_CALLBACK_SPECS) {
        if (!spec.ownerClassNames.has(className)) continue;
        if (!spec.constructorMethodNames.has(methodName)) continue;
        const optionsValue = explicitArgs[spec.optionsArgIndex];
        const optionClass = resolveClassFromValue(scene, optionsValue);
        if (!optionClass) continue;
        for (const field of optionClass.getFields()) {
            const fieldName = field.getName?.() || "";
            if (!spec.callbackFieldNames.has(fieldName)) continue;
            const callbackSig = field.getType?.()?.getMethodSignature?.();
            if (!callbackSig) continue;
            const callbackMethod = scene.getMethod(callbackSig);
            if (!callbackMethod?.getCfg?.()) continue;
            const callbackSignature = callbackMethod.getSignature?.()?.toString?.() || "";
            if (!callbackSignature) continue;
            const registrationSignature = methodSig?.toString?.() || "";
            const key = `${callbackSignature}|field:${fieldName}|call:${registrationSignature}`;
            if (out.has(key)) continue;
            out.set(key, {
                callbackMethod,
                sourceMethod,
                registrationMethod: sourceMethod,
                registrationInvokeExpr: invokeExpr,
                registrationMethodName: methodName,
                registrationOwnerName: className,
                registrationSignature,
                callbackArgIndex: spec.optionsArgIndex,
                reason: `${spec.reasonLabel} ${className}.${fieldName} from ${sourceMethod.getName()}`,
                callbackFlavor: "channel",
                registrationShape: "options_object_slot",
                slotFamily: "controller_option_slot",
                recognitionLayer: "controller_options",
            });
        }
    }

    return [...out.values()];
}

export function resolveKnownKeyedCallbackRegistrationsFromStmt(
    stmt: any,
    scene: Scene,
    sourceMethod: ArkMethod,
): KeyedCallbackDispatchRegistration[] {
    const invokeExpr = stmt?.getInvokeExpr?.();
    if (!invokeExpr) return [];
    const family = matchKnownKeyedCallbackDispatchFamily(invokeExpr, "registration");
    if (!family) return [];

    const explicitArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
    const keyValue = explicitArgs[family.keyArgIndex];
    const dispatchKeys = keyValue
        ? collectFiniteStringCandidatesFromValue(scene, keyValue)
        : [];
    if (dispatchKeys.length === 0) return [];

    const registrations = resolveCallbackRegistrationsFromStmt(
        stmt,
        scene,
        sourceMethod,
        args => resolveKnownKeyedCallbackDispatchRegistration(args),
    );
    return registrations
        .filter(reg => reg.callbackArgIndex === family.callbackArgIndex)
        .map(reg => ({
            ...reg,
            familyId: family.familyId,
            dispatchKeys,
        }));
}

export function collectKnownKeyedDispatchKeysFromMethod(
    scene: Scene,
    method: ArkMethod,
): Map<string, Set<string>> {
    const out = new Map<string, Set<string>>();
    const cfg = method.getCfg?.();
    if (!cfg) return out;

    for (const stmt of cfg.getStmts()) {
        const invokeExpr = stmt?.getInvokeExpr?.();
        if (!invokeExpr) continue;
        const family = matchKnownKeyedCallbackDispatchFamily(invokeExpr, "dispatch");
        if (!family) continue;

        const explicitArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
        const keyValue = explicitArgs[family.keyArgIndex];
        if (!keyValue) continue;
        const keys = collectFiniteStringCandidatesFromValue(scene, keyValue);
        if (keys.length === 0) continue;

        if (!out.has(family.familyId)) {
            out.set(family.familyId, new Set<string>());
        }
        const familyKeys = out.get(family.familyId)!;
        for (const key of keys) {
            familyKeys.add(key);
        }
    }

    return out;
}

function resolveKnownKeyedCallbackDispatchRegistration(
    args: CallbackRegistrationMatchArgs,
): CallbackRegistrationMatch | null {
    const family = matchKnownKeyedCallbackDispatchFamily(args.invokeExpr, "registration");
    if (!family) return null;
    return {
        callbackArgIndexes: [family.callbackArgIndex],
        reason: `Keyed callback registration ${describeRegistrationOwner(args.invokeExpr?.getMethodSignature?.())}.${args.invokeExpr?.getMethodSignature?.().getMethodSubSignature?.().getMethodName?.() || ""} from ${args.sourceMethod.getName()}`,
        callbackFlavor: "channel",
        registrationShape: "keyed_dispatch_slot",
        slotFamily: "keyed_dispatch_slot",
        recognitionLayer: "keyed_dispatch",
    };
}

function matchKnownKeyedCallbackDispatchFamily(
    invokeExpr: any,
    mode: "registration" | "dispatch",
): KeyedCallbackDispatchFamilySpec | undefined {
    const methodSig = invokeExpr?.getMethodSignature?.();
    const methodName = methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "";
    const className = methodSig?.getDeclaringClassSignature?.()?.getClassName?.() || "";
    return KNOWN_KEYED_CALLBACK_DISPATCH_FAMILIES.find(family => {
        if (!family.ownerClassNames.has(className)) return false;
        return mode === "registration"
            ? family.registrationMethodNames.has(methodName)
            : family.dispatchMethodNames.has(methodName);
    });
}

function describeRegistrationOwner(methodSig: any): string {
    return methodSig?.getDeclaringClassSignature?.()?.getClassName?.() || "@channel";
}

function resolveClassFromValue(scene: Scene, value: any): any | null {
    const classSignature = value?.getType?.()?.getClassSignature?.();
    if (!classSignature) return null;
    return scene.getClass(classSignature) || null;
}
