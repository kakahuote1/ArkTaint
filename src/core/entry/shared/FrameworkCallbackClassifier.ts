import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { ArkMethod } from "../../../../arkanalyzer/out/src/core/model/ArkMethod";
import {
    isSdkBackedMethodSignature,
} from "../../substrate/queries/SdkProvenance";
import {
    resolveMethodsFromAnonymousObjectCarrierByField,
    resolveInvokeMethodName,
} from "../../substrate/queries/CalleeResolver";
import {
    CallbackRegistrationMatchArgs,
    CallbackRegistrationMatchBase,
    ResolvedCallbackRegistration,
    resolveCallbackMethodsFromValueWithReturns,
} from "../../substrate/queries/CallbackBindingQuery";

export interface FrameworkCallbackResolutionPolicy {
    enableSdkProvenance?: boolean;
}

export type CallbackRegistrationFlavor = "ui_event" | "channel";

export type CallbackRegistrationShape =
    | "direct_callback_slot"
    | "string_plus_callback_slot"
    | "wrapped_builder_slot"
    | "trailing_callback_slot"
    | "options_object_slot"
    | "keyed_dispatch_slot";

export type CallbackRegistrationSlotFamily =
    | "ui_direct_slot"
    | "gesture_direct_slot"
    | "builder_node_build_slot"
    | "system_direct_slot"
    | "subscription_event_slot"
    | "completion_callback_slot"
    | "p2p_message_receiver_slot"
    | "controller_option_slot"
    | "component_property_slot"
    | "project_component_option_slot"
    | "web_js_proxy_slot"
    | "keyed_dispatch_slot"
    | "scheduler_slot";

export type CallbackRegistrationRecognitionLayer =
    | "sdk_provenance"
    | "controller_options"
    | "component_options"
    | "web_js_proxy_options"
    | "keyed_dispatch";

export interface CallbackRegistrationMatch extends CallbackRegistrationMatchBase {
    callbackFlavor?: CallbackRegistrationFlavor;
    registrationShape?: CallbackRegistrationShape;
    slotFamily?: CallbackRegistrationSlotFamily;
    recognitionLayer?: CallbackRegistrationRecognitionLayer;
    callbackFieldName?: string;
}

export type FrameworkResolvedCallbackRegistration = ResolvedCallbackRegistration<CallbackRegistrationMatch>;

export type KeyedCallbackDispatchRegistration = FrameworkResolvedCallbackRegistration & {
    familyId: string;
    dispatchKeys: string[];
};

interface CallableParameterSlot {
    index: number;
    rest: boolean;
}

const DEFAULT_MAX_CALLBACK_HELPER_DEPTH = 4;
const DEFAULT_FRAMEWORK_CALLBACK_RESOLUTION_POLICY: Required<FrameworkCallbackResolutionPolicy> = {
    enableSdkProvenance: true,
};

export function resolveKnownFrameworkCallbackRegistration(
    args: CallbackRegistrationMatchArgs,
): CallbackRegistrationMatch | null {
    return resolveKnownFrameworkCallbackRegistrationWithPolicy(args);
}

export function resolveKnownFrameworkCallbackRegistrationWithPolicy(
    args: CallbackRegistrationMatchArgs,
    policy: FrameworkCallbackResolutionPolicy = DEFAULT_FRAMEWORK_CALLBACK_RESOLUTION_POLICY,
): CallbackRegistrationMatch | null {
    const effectivePolicy = normalizeFrameworkCallbackResolutionPolicy(policy);
    if (!effectivePolicy.enableSdkProvenance) {
        return null;
    }
    return resolveSdkSignatureCallableRegistration(args)
        || resolveStructuralArkUiDslCallbackRegistration(args);
}

export function resolveKnownSchedulerCallbackRegistration(
    args: CallbackRegistrationMatchArgs,
): CallbackRegistrationMatch | null {
    void args;
    return null;
}

export function resolveKnownChannelCallbackRegistration(
    args: CallbackRegistrationMatchArgs,
): CallbackRegistrationMatch | null {
    return resolveSdkSignatureCallableRegistration(args)
        || resolveStructuralArkUiDslCallbackRegistration(args);
}

export function resolveKnownControllerOptionCallbackRegistrationsFromStmt(
    stmt: any,
    scene: Scene,
    sourceMethod: ArkMethod,
): FrameworkResolvedCallbackRegistration[] {
    const invokeExpr = stmt?.getInvokeExpr?.();
    if (!invokeExpr) return [];

    const methodSig = invokeExpr.getMethodSignature?.();
    if (!hasExactSdkCallableRegistrationProvenance(scene, sourceMethod, invokeExpr, methodSig)) {
        return [];
    }

    const explicitArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
    const out = new Map<string, FrameworkResolvedCallbackRegistration>();

    for (const slot of collectDeclaredCallableOptionSlots(scene, methodSig, explicitArgs.length)) {
        const optionsValue = explicitArgs[slot.index];
        if (!optionsValue) continue;
        for (const fieldName of slot.fieldNames) {
            for (const callbackMethod of resolveMethodsFromAnonymousObjectCarrierByField(scene, optionsValue, fieldName, {
                maxCandidates: 16,
                enableLocalBacktrace: true,
                maxBacktraceSteps: 6,
                maxVisitedDefs: 24,
            })) {
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
                    registrationMethodName: methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "",
                    registrationOwnerName: describeRegistrationOwner(methodSig),
                    registrationSignature,
                    callbackArgIndex: slot.index,
                    callbackFieldName: fieldName,
                    reason: `SDK option callback field ${fieldName} from ${sourceMethod.getName()}`,
                    registrationShape: "options_object_slot",
                    slotFamily: "controller_option_slot",
                    recognitionLayer: "sdk_provenance",
                });
            }
        }
    }

    return [...out.values()];
}

export function resolveKnownKeyedCallbackRegistrationsFromStmt(
    stmt: any,
    scene: Scene,
    sourceMethod: ArkMethod,
): KeyedCallbackDispatchRegistration[] {
    void stmt;
    void scene;
    void sourceMethod;
    return [];
}

export function collectKnownKeyedDispatchKeysFromMethod(
    scene: Scene,
    method: ArkMethod,
): Map<string, Set<string>> {
    void scene;
    void method;
    return new Map<string, Set<string>>();
}

export function isKnownFrameworkCallbackMethodName(methodName: string): boolean {
    void methodName;
    return false;
}

export function isKnownSchedulerMethodName(methodName: string | undefined): boolean {
    void methodName;
    return false;
}

function resolveSdkSignatureCallableRegistration(
    args: CallbackRegistrationMatchArgs,
): CallbackRegistrationMatch | null {
    const invokeExpr = args.invokeExpr;
    const methodSig = invokeExpr?.getMethodSignature?.();
    if (!hasExactSdkCallableRegistrationProvenance(args.scene, args.sourceMethod, invokeExpr, methodSig)) {
        return null;
    }

    const explicitArgs = args.explicitArgs || [];
    const actualCallableArgIndexes = new Set(inferCallableArgIndexes(args.scene, explicitArgs));
    if (actualCallableArgIndexes.size === 0) {
        return null;
    }

    const callbackArgIndexes = collectDeclaredCallableArgIndexes(args.scene, methodSig, explicitArgs.length)
        .filter(index => actualCallableArgIndexes.has(index));
    if (callbackArgIndexes.length === 0) {
        return null;
    }

    const methodName = methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "";
    const registrationShape = inferRegistrationShape(explicitArgs, callbackArgIndexes);
    const slotFamily = inferSdkCallbackSlotFamily(methodSig, registrationShape);
    return {
        callbackArgIndexes,
        reason: `SDK signature callback registration ${describeRegistrationOwner(methodSig)}.${methodName} from ${args.sourceMethod.getName()}`,
        callbackFlavor: slotFamily === "ui_direct_slot" || slotFamily === "gesture_direct_slot" ? "ui_event" : "channel",
        registrationShape,
        slotFamily,
        recognitionLayer: "sdk_provenance",
    };
}

function resolveStructuralArkUiDslCallbackRegistration(
    args: CallbackRegistrationMatchArgs,
): CallbackRegistrationMatch | null {
    const invokeExpr = args.invokeExpr;
    const signatureText = String(invokeExpr?.getMethodSignature?.()?.toString?.() || "");
    if (!signatureText.includes("%unk")) {
        return null;
    }
    if (!isCompositionSourceMethod(args.sourceMethod)) {
        return null;
    }

    const methodName = resolveInvokeMethodName(invokeExpr);
    const slotFamily = classifyStructuralArkUiDslSlotFamily(methodName);
    if (!slotFamily) {
        return null;
    }

    const explicitArgs = args.explicitArgs || [];
    const callbackArgIndexes = inferCallableArgIndexes(args.scene, explicitArgs);
    if (callbackArgIndexes.length === 0) {
        return null;
    }

    return {
        callbackArgIndexes,
        reason: `ArkUI structural callback registration ${methodName} from ${args.sourceMethod.getName?.() || "<unknown>"}`,
        callbackFlavor: "ui_event",
        registrationShape: inferRegistrationShape(explicitArgs, callbackArgIndexes),
        slotFamily,
        recognitionLayer: "sdk_provenance",
    };
}

function isCompositionSourceMethod(sourceMethod: ArkMethod | undefined): boolean {
    const methodName = sourceMethod?.getName?.() || "";
    if (methodName === "build") {
        return true;
    }
    const signatureText = String(sourceMethod?.getSignature?.()?.toString?.() || "");
    return signatureText.includes("-build.");
}

function classifyStructuralArkUiDslSlotFamily(methodName: string): CallbackRegistrationSlotFamily | undefined {
    if (methodName === "onAction" || methodName.startsWith("onAction")) {
        return "gesture_direct_slot";
    }
    const uiEventMethods = new Set([
        "onClick",
        "onChange",
        "onSubmit",
        "onInput",
        "onPaste",
        "onCopy",
        "onCut",
        "onWillInsert",
        "onDidInsert",
        "onWillDelete",
        "onDidDelete",
        "onWillChange",
        "inputFilter",
    ]);
    return uiEventMethods.has(methodName) ? "ui_direct_slot" : undefined;
}

function hasExactSdkCallableRegistrationProvenance(
    scene: Scene,
    sourceMethod: ArkMethod,
    invokeExpr: any,
    methodSig: any,
): boolean {
    if (!methodSig) {
        return false;
    }
    if (isTypeScriptStandardLibraryMethodSignature(methodSig)) {
        return false;
    }
    return isSdkBackedMethodSignature(scene, methodSig, { sourceMethod, invokeExpr });
}

function collectDeclaredCallableArgIndexes(
    scene: Scene,
    methodSig: any,
    explicitArgCount: number,
): number[] {
    const out = new Set<number>();
    for (const slot of collectDeclaredCallableParameterSlots(scene, methodSig)) {
        if (slot.rest) {
            for (let index = slot.index; index < explicitArgCount; index += 1) {
                out.add(index);
            }
            continue;
        }
        if (slot.index >= 0 && slot.index < explicitArgCount) {
            out.add(slot.index);
        }
    }
    return [...out.values()].sort((a, b) => a - b);
}

function collectDeclaredCallableParameterSlots(
    scene: Scene,
    methodSig: any,
): CallableParameterSlot[] {
    const parameters = methodSig?.getMethodSubSignature?.()?.getParameters?.() || [];
    const out: CallableParameterSlot[] = [];
    parameters.forEach((parameter: any, index: number) => {
        const type = parameter?.getType?.();
        if (!isCallableLikeType(scene, type)) {
            return;
        }
        out.push({
            index,
            rest: isRestParameter(parameter),
        });
    });
    return out;
}

function collectDeclaredCallableOptionSlots(
    scene: Scene,
    methodSig: any,
    explicitArgCount: number,
): Array<{ index: number; fieldNames: string[] }> {
    const parameters = methodSig?.getMethodSubSignature?.()?.getParameters?.() || [];
    const out: Array<{ index: number; fieldNames: string[] }> = [];
    parameters.forEach((parameter: any, index: number) => {
        if (index < 0 || index >= explicitArgCount) {
            return;
        }
        const fieldNames = collectCallableFieldNamesFromType(scene, parameter?.getType?.());
        if (fieldNames.length === 0) {
            return;
        }
        out.push({ index, fieldNames });
    });
    return out;
}

function collectCallableFieldNamesFromType(
    scene: Scene,
    type: any,
): string[] {
    const out = new Set<string>();
    for (const klass of resolveArkClassesFromType(scene, type)) {
        for (const field of klass?.getFields?.() || []) {
            const fieldName = field?.getName?.() || "";
            if (!fieldName) continue;
            if (!isCallableLikeType(scene, field?.getType?.())) continue;
            out.add(fieldName);
        }
    }
    return [...out.values()].sort((left, right) => left.localeCompare(right));
}

function inferCallableArgIndexes(scene: Scene, explicitArgs: any[]): number[] {
    const callbackArgIndexes: number[] = [];
    explicitArgs.forEach((arg, index) => {
        const methods = resolveCallbackMethodsFromValueWithReturns(scene, arg, {
            maxDepth: DEFAULT_MAX_CALLBACK_HELPER_DEPTH,
        });
        if (methods.length > 0) {
            callbackArgIndexes.push(index);
        }
    });
    return callbackArgIndexes;
}

function inferRegistrationShape(
    explicitArgs: any[],
    callbackArgIndexes: number[],
): CallbackRegistrationShape | undefined {
    if (callbackArgIndexes.length === 0) {
        return undefined;
    }
    if (callbackArgIndexes.length > 1) {
        return "trailing_callback_slot";
    }

    const callbackIndex = callbackArgIndexes[0];
    if (callbackIndex === 0) {
        return "direct_callback_slot";
    }
    if (callbackIndex === 1 && explicitArgs.length >= 2 && looksLikeStringArg(explicitArgs[0])) {
        return "string_plus_callback_slot";
    }
    return "trailing_callback_slot";
}

function inferSdkCallbackSlotFamily(
    methodSig: any,
    registrationShape: CallbackRegistrationShape | undefined,
): CallbackRegistrationSlotFamily | undefined {
    if (!registrationShape) {
        return undefined;
    }

    const methodName = String(methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "");
    const ownerText = String(methodSig?.getDeclaringClassSignature?.()?.toString?.() || "");
    const fileText = String(methodSig?.getDeclaringClassSignature?.()?.getDeclaringFileSignature?.()?.toString?.() || "")
        .replace(/\\/g, "/");
    const declarationText = `${fileText} ${ownerText} ${methodName}`.toLowerCase();

    if (registrationShape === "options_object_slot") {
        return "controller_option_slot";
    }
    if (declarationText.includes("gesture") || /^onaction/i.test(methodName)) {
        return "gesture_direct_slot";
    }
    if (declarationText.includes("/component/ets/")) {
        return "ui_direct_slot";
    }
    if (registrationShape === "string_plus_callback_slot" || methodName === "on" || methodName === "once") {
        return "subscription_event_slot";
    }
    if (registrationShape === "trailing_callback_slot" && methodName === "subscribe") {
        return "completion_callback_slot";
    }
    if (/^(create|get|request|read|write|open|close|start|stop|load|save|query|insert|update|delete|remove|copy|move|pack|unpack|encode|decode)/i.test(methodName)) {
        return "completion_callback_slot";
    }
    return "system_direct_slot";
}

function normalizeFrameworkCallbackResolutionPolicy(
    policy: FrameworkCallbackResolutionPolicy,
): Required<FrameworkCallbackResolutionPolicy> {
    return {
        enableSdkProvenance: policy.enableSdkProvenance ?? true,
    };
}

function resolveArkClassesFromType(
    scene: Scene,
    type: any,
    depth: number = 0,
    seen: Set<string> = new Set<string>(),
): any[] {
    if (!type || depth > 4) {
        return [];
    }

    const out: any[] = [];
    const pushUnique = (klass: any): void => {
        if (!klass) return;
        const key = klass.getSignature?.()?.toString?.() || klass.getName?.() || "";
        if (!key || seen.has(key)) return;
        seen.add(key);
        out.push(klass);
    };

    const classSignature = type.getClassSignature?.();
    if (classSignature) {
        pushUnique(scene.getClass(classSignature));
    }

    const originalType = type.getOriginalType?.();
    if (originalType) {
        for (const klass of resolveArkClassesFromType(scene, originalType, depth + 1, seen)) {
            pushUnique(klass);
        }
    }

    const unionTypes = type.getTypes?.();
    if (Array.isArray(unionTypes)) {
        for (const unionType of unionTypes) {
            for (const klass of resolveArkClassesFromType(scene, unionType, depth + 1, seen)) {
                pushUnique(klass);
            }
        }
    }

    const currType = type.getCurrType?.();
    if (currType && currType !== type) {
        for (const klass of resolveArkClassesFromType(scene, currType, depth + 1, seen)) {
            pushUnique(klass);
        }
    }

    return out;
}

function isCallableLikeType(
    scene: Scene,
    type: any,
    depth: number = 0,
): boolean {
    if (!type || depth > 4) {
        return false;
    }
    if (type.getMethodSignature?.()) {
        return true;
    }
    const methodSignatures = type.getMethodSignatures?.();
    if (Array.isArray(methodSignatures) && methodSignatures.length > 0) {
        return true;
    }
    const callSignature = type.getCallSignature?.() || type.getFunctionSignature?.() || type.getFuncSignature?.();
    if (callSignature) {
        return true;
    }

    const originalType = type.getOriginalType?.();
    if (originalType && isCallableLikeType(scene, originalType, depth + 1)) {
        return true;
    }

    const unionTypes = type.getTypes?.();
    if (Array.isArray(unionTypes) && unionTypes.some((unionType: any) => isCallableLikeType(scene, unionType, depth + 1))) {
        return true;
    }

    const currType = type.getCurrType?.();
    if (currType && currType !== type && isCallableLikeType(scene, currType, depth + 1)) {
        return true;
    }

    return false;
}

function isRestParameter(parameter: any): boolean {
    if (parameter?.isRestParameter?.()) {
        return true;
    }
    const name = String(parameter?.getName?.() || parameter?.name || "");
    if (name.startsWith("...")) {
        return true;
    }
    const text = String(parameter?.toString?.() || "");
    return text.trim().startsWith("...");
}

function isTypeScriptStandardLibraryMethodSignature(methodSig: any): boolean {
    const fileText = String(
        methodSig
            ?.getDeclaringClassSignature?.()
            ?.getDeclaringFileSignature?.()
            ?.toString?.() || "",
    ).replace(/\\/g, "/");
    return /(?:^|\/)typescript\/lib\/lib\.[^/]+\.d\.ts$/i.test(fileText)
        || /(?:^|\/)lib\.[^/]+\.d\.ts$/i.test(fileText);
}

function describeRegistrationOwner(methodSig: any): string {
    return methodSig?.getDeclaringClassSignature?.()?.getClassName?.() || "@sdk";
}

function looksLikeStringArg(value: any): boolean {
    if (!value) return false;
    const typeText = String(value.getType?.()?.toString?.() || "").toLowerCase().trim();
    if (/^string(\s*\||$)/.test(typeText)) {
        return true;
    }
    const text = String(value.toString?.() || "").trim();
    return /^['"`].+['"`]$/.test(text);
}
