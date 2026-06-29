import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { ArkAssignStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkInstanceFieldRef, ClosureFieldRef } from "../../../../arkanalyzer/out/src/core/base/Ref";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import { isSdkBackedMethodSignature } from "../queries/SdkProvenance";
import {
    CallbackRegistrationMatchArgs,
    CallbackRegistrationMatchBase,
    ResolvedCallbackRegistration,
    resolveCallbackMethodsFromValueWithReturns,
} from "../queries/CallbackBindingQuery";
import { resolveMethodsFromAnonymousObjectCarrierByField } from "../queries/CalleeResolver";

export type CallbackRegistrationFlavor = "ui_event" | "channel";

export type CallbackRegistrationShape =
    | "direct_callback_slot"
    | "string_plus_callback_slot"
    | "trailing_callback_slot"
    | "options_object_slot"
    | "keyed_dispatch_slot";

export type CallbackRegistrationSlotFamily =
    | "ui_direct_slot"
    | "gesture_direct_slot"
    | "system_direct_slot"
    | "subscription_event_slot"
    | "completion_callback_slot"
    | "controller_option_slot"
    | "web_js_proxy_slot"
    | "keyed_dispatch_slot"
    | "scheduler_slot"
    | "p2p_message_receiver_slot"
    | "builder_node_build_slot";

export type CallbackRegistrationRecognitionLayer =
    | "sdk_provenance"
    | "controller_options"
    | "web_js_proxy_options"
    | "keyed_dispatch";

export interface CallbackRegistrationMatch extends CallbackRegistrationMatchBase {
    callbackFlavor?: CallbackRegistrationFlavor;
    registrationShape?: CallbackRegistrationShape;
    slotFamily?: CallbackRegistrationSlotFamily;
    recognitionLayer?: CallbackRegistrationRecognitionLayer;
}

export type FrameworkResolvedCallbackRegistration = ResolvedCallbackRegistration<CallbackRegistrationMatch>;

const DEFAULT_MAX_CALLBACK_HELPER_DEPTH = 4;

export function resolveKnownFrameworkCallbackRegistration(
    args: CallbackRegistrationMatchArgs,
): CallbackRegistrationMatch | null {
    const methodSig = args.invokeExpr?.getMethodSignature?.();
    if (!isSdkBackedMethodSignature(args.scene, methodSig, { sourceMethod: args.sourceMethod, invokeExpr: args.invokeExpr })) {
        return null;
    }
    if (isTypeScriptStandardLibrarySignature(methodSig)) {
        return null;
    }

    const callbackArgIndexes = inferDeclaredCallableArgIndexes(args.scene, methodSig, args.explicitArgs || []);
    if (callbackArgIndexes.length === 0) {
        return null;
    }

    const methodName = methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "<unknown>";

    return {
        callbackArgIndexes,
        reason: `SDK-declared callback registration ${describeRegistrationOwner(methodSig)}.${methodName} from ${args.sourceMethod.getName()}`,
        registrationShape: inferRegistrationShape(args.explicitArgs || [], callbackArgIndexes),
        recognitionLayer: "sdk_provenance",
    };
}

function describeRegistrationOwner(methodSig: any): string {
    return methodSig?.getDeclaringClassSignature?.()?.getClassName?.() || "@sdk";
}

function inferDeclaredCallableArgIndexes(scene: Scene, methodSig: any, explicitArgs: any[]): number[] {
    const parameterSlots = collectCallableParameterSlots(scene, methodSig);
    if (parameterSlots.length === 0) {
        return [];
    }

    const callbackArgIndexes: number[] = [];
    explicitArgs.forEach((arg, index) => {
        if (!parameterSlots.some(slot => slot.index === index || (slot.rest && index >= slot.index))) {
            return;
        }
        const methods = resolveCallbackMethodsFromValueWithReturns(scene, arg, {
            maxDepth: DEFAULT_MAX_CALLBACK_HELPER_DEPTH,
        });
        const anonymousCarrierMethods = collectAnonymousCarrierFieldMethods(scene, arg);
        if (methods.length > 0 || anonymousCarrierMethods.length > 0) {
            callbackArgIndexes.push(index);
        }
    });
    return callbackArgIndexes;
}

function collectCallableParameterSlots(scene: Scene, methodSig: any): Array<{ index: number; rest: boolean }> {
    const parameters = methodSig?.getMethodSubSignature?.()?.getParameters?.() || [];
    const out: Array<{ index: number; rest: boolean }> = [];
    parameters.forEach((parameter: any, index: number) => {
        if (!isCallableLikeType(scene, parameter?.getType?.())) {
            return;
        }
        out.push({
            index,
            rest: isRestParameter(parameter),
        });
    });
    return out;
}

function collectAnonymousCarrierFieldMethods(scene: Scene, value: any): any[] {
    const lookups = collectAnonymousCarrierFieldLookups(value);
    const out: any[] = [];
    const seen = new Set<string>();
    for (const lookup of lookups) {
        for (const method of resolveMethodsFromAnonymousObjectCarrierByField(
            scene,
            lookup.baseValue,
            lookup.fieldName,
            { maxCandidates: DEFAULT_MAX_CALLBACK_HELPER_DEPTH },
        )) {
            const sig = method?.getSignature?.().toString?.();
            if (!sig || seen.has(sig)) continue;
            seen.add(sig);
            out.push(method);
        }
    }
    return out;
}

function collectAnonymousCarrierFieldLookups(
    value: any,
): Array<{ baseValue: any; fieldName: string }> {
    const out: Array<{ baseValue: any; fieldName: string }> = [];
    const seen = new Set<string>();
    const addLookup = (baseValue: any, fieldName: string | undefined): void => {
        if (!baseValue || !fieldName) return;
        const key = `${String(baseValue)}::${fieldName}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ baseValue, fieldName });
    };

    if (value instanceof ArkInstanceFieldRef || value instanceof ClosureFieldRef) {
        const fieldName = value instanceof ClosureFieldRef
            ? value.getFieldName?.()
            : value.getFieldSignature?.().getFieldName?.() || value.getFieldName?.();
        addLookup(value.getBase?.(), fieldName);
        return out;
    }

    const declStmt = value?.getDeclaringStmt?.();
    if (value instanceof Local && declStmt instanceof ArkAssignStmt && declStmt.getLeftOp?.() === value) {
        const right = declStmt.getRightOp?.();
        if (right instanceof ArkInstanceFieldRef || right instanceof ClosureFieldRef) {
            const fieldName = right instanceof ClosureFieldRef
                ? right.getFieldName?.()
                : right.getFieldSignature?.().getFieldName?.() || right.getFieldName?.();
            addLookup(right.getBase?.(), fieldName);
        }
    }

    return out;
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

function isTypeScriptStandardLibrarySignature(methodSig: any): boolean {
    const declaringFileText = signatureDeclaringFileText(methodSig).toLowerCase();
    return /(?:^|[\\/])lib\.[^\\/]+\.d\.ts$/.test(declaringFileText);
}

function signatureDeclaringFileText(methodSig: any): string {
    return String(methodSig?.getDeclaringClassSignature?.()?.getDeclaringFileSignature?.()?.toString?.() || "");
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

function isCallableLikeType(
    scene: Scene,
    type: any,
    depth: number = 0,
    seen: Set<string> = new Set<string>(),
): boolean {
    void scene;
    if (!type || depth > 4) {
        return false;
    }
    const key = String(type.toString?.() || type.getTypeString?.() || type.constructor?.name || "");
    if (key && seen.has(key)) {
        return false;
    }
    if (key) {
        seen.add(key);
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
    if (originalType && isCallableLikeType(scene, originalType, depth + 1, seen)) {
        return true;
    }
    const currType = type.getCurrType?.();
    if (currType && currType !== type && isCallableLikeType(scene, currType, depth + 1, seen)) {
        return true;
    }
    const unionTypes = type.getTypes?.();
    if (Array.isArray(unionTypes)) {
        return unionTypes.some((unionType: any) => isCallableLikeType(scene, unionType, depth + 1, seen));
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
