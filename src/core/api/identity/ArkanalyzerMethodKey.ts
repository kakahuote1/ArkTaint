export type { ArkanalyzerMethodKey } from "./CanonicalApiDescriptor";
import { normalizeProjectLogicalFilePath, normalizeProjectLogicalTypeText } from "./ProjectLogicalPathNormalization";

export function arkanalyzerMethodKeyString(key: import("./CanonicalApiDescriptor").ArkanalyzerMethodKey): string {
    const normalizedOwner = normalizeArkanalyzerDeclaringOwner(
        key.declaringNamespacePath || [],
        key.declaringClassName,
    );
    return JSON.stringify({
        declaringFileName: normalizeArkanalyzerDeclaringFileName(key.declaringFileName),
        declaringNamespacePath: normalizedOwner.declaringNamespacePath,
        declaringClassName: normalizedOwner.declaringClassName,
        methodName: key.methodName,
        parameterTypes: (key.parameterTypes || []).map(normalizeProjectLogicalTypeText),
        returnType: normalizeProjectLogicalTypeText(key.returnType),
        staticFlag: !!key.staticFlag,
    });
}

export function isKnownArkanalyzerMethodKey(key: import("./CanonicalApiDescriptor").ArkanalyzerMethodKey): boolean {
    const values = [
        key.declaringFileName,
        key.declaringClassName,
        key.methodName,
        key.returnType,
        ...(key.parameterTypes || []),
    ];
    return values.every(value => !String(value || "").includes("%unk"));
}

export function normalizeArkanalyzerDeclaringFileName(value: string): string {
    return normalizeProjectLogicalFilePath(value);
}

function normalizeArkanalyzerDeclaringOwner(
    namespacePath: readonly string[],
    className: string,
): {
    declaringNamespacePath: string[];
    declaringClassName: string;
} {
    const namespace = namespacePath
        .flatMap(part => splitOwnerPath(part))
        .filter(Boolean);
    const classParts = splitOwnerPath(className);
    if (classParts.length > 1) {
        return {
            declaringNamespacePath: [...namespace, ...classParts.slice(0, -1)],
            declaringClassName: classParts[classParts.length - 1],
        };
    }
    return {
        declaringNamespacePath: namespace,
        declaringClassName: classParts[0] || String(className || "").trim(),
    };
}

function splitOwnerPath(value: string): string[] {
    return String(value || "")
        .split(".")
        .map(item => item.trim())
        .filter(Boolean);
}
