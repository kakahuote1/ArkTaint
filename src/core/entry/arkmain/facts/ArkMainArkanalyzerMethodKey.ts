import type { ArkMethod } from "../../../../../arkanalyzer/out/src/core/model/ArkMethod";
import type { ArkanalyzerMethodKey } from "../../../api/identity";

export function arkanalyzerMethodKeyFromMethod(method: ArkMethod): ArkanalyzerMethodKey | undefined {
    const signature = method.getSignature?.();
    if (!signature) return undefined;
    return arkanalyzerMethodKeyFromSignature(signature, (method as any).isStatic?.() === true);
}

export const arkanalyzerMethodKeyFromArkMethod = arkanalyzerMethodKeyFromMethod;

export function arkanalyzerMethodKeyFromSignature(signature: any, staticFlag: boolean): ArkanalyzerMethodKey | undefined {
    const declaringClass = signature.getDeclaringClassSignature?.();
    const subSignature = signature.getMethodSubSignature?.();
    const key: ArkanalyzerMethodKey = {
        declaringFileName: String(declaringClass?.getDeclaringFileSignature?.()?.toString?.() || "").trim(),
        declaringNamespacePath: namespacePathFromClassSignature(declaringClass),
        declaringClassName: String(declaringClass?.getClassName?.() || "").trim(),
        methodName: String(subSignature?.getMethodName?.() || "").trim(),
        parameterTypes: (subSignature?.getParameters?.() || []).map((param: any) => typeTextOf(param)),
        returnType: typeTextOf(subSignature?.getReturnType?.()),
        staticFlag,
    };
    return isCompleteArkanalyzerMethodKey(key) ? key : undefined;
}

export function sameArkanalyzerMethodKey(left: ArkanalyzerMethodKey, right: ArkanalyzerMethodKey): boolean {
    return left.declaringFileName === right.declaringFileName
        && left.declaringClassName === right.declaringClassName
        && left.methodName === right.methodName
        && left.returnType === right.returnType
        && left.staticFlag === right.staticFlag
        && arrayEquals(left.declaringNamespacePath, right.declaringNamespacePath)
        && arrayEquals(left.parameterTypes, right.parameterTypes);
}

function namespacePathFromClassSignature(declaringClass: any): string[] {
    const text = String(declaringClass?.getDeclaringNamespaceSignature?.()?.toString?.() || "")
        .replace(/\\/g, "/")
        .replace(/:\s*$/g, "")
        .trim();
    if (!text) return [];
    const colon = text.lastIndexOf(":");
    const namespaceText = (colon >= 0 ? text.slice(colon + 1) : text).trim();
    if (!namespaceText || namespaceText === "%dflt") return [];
    return namespaceText.split(".").map(part => part.trim()).filter(part => part.length > 0 && part !== "%dflt");
}

function typeTextOf(value: any): string {
    return String(value?.getType?.()?.toString?.() || value?.toString?.() || "").trim();
}

function isCompleteArkanalyzerMethodKey(key: ArkanalyzerMethodKey): boolean {
    return !!key.declaringFileName
        && !!key.declaringClassName
        && !!key.methodName
        && !!key.returnType
        && !containsUnknownIdentityText(key.declaringFileName)
        && !containsUnknownIdentityText(key.declaringClassName)
        && !containsUnknownIdentityText(key.methodName)
        && !containsUnknownIdentityText(key.returnType)
        && key.parameterTypes.every(item => !!item && !containsUnknownIdentityText(item));
}

function containsUnknownIdentityText(value: unknown): boolean {
    const text = String(value || "").trim().toLowerCase();
    return !text || text.includes("%unk") || text.includes("@unk") || text.includes("unknown");
}

function arrayEquals(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((item, index) => item === right[index]);
}
