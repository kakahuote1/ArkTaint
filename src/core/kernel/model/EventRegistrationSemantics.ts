import type { Scene } from "../../../../arkanalyzer/out/src/Scene";

export interface EventRegistrationSemantics {
    callbackArgIndexes: number[];
    reason: string;
}

export function recoverEventRegistrationSemantics(options: {
    scene: Scene;
    sourceMethod: any;
    invokeExpr: any;
    explicitArgs: any[];
    callableArgIndexes: number[];
    isDeferredCompletion: boolean;
}): EventRegistrationSemantics | null {
    if (options.isDeferredCompletion) {
        return null;
    }
    if (!looksLikeEventRegistrationByConvention(options.invokeExpr)) {
        return null;
    }
    const callbackArgIndexes = options.callableArgIndexes
        .filter(index => index >= 0 && index < options.explicitArgs.length);
    if (callbackArgIndexes.length === 0) {
        return null;
    }

    const methodName = options.invokeExpr?.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || "<unknown>";
    return {
        callbackArgIndexes,
        reason: `Structural registration ${methodName} from ${options.sourceMethod?.getName?.() || "<unknown>"}`,
    };
}

export function looksLikeEventRegistrationByConvention(invokeExpr: any): boolean {
    const invokeName = invokeExpr?.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || "";
    if (!invokeName) return false;
    const normalized = invokeName.trim();
    if (
        normalized === "on"
        || normalized === "bind"
        || normalized === "subscribe"
        || normalized === "setTimeout"
        || normalized === "setInterval"
        || normalized === "queueMicrotask"
        || normalized === "requestAnimationFrame"
    ) {
        return true;
    }
    return /^on[A-Z_]/.test(normalized);
}
