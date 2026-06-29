import type { KnownShapeConstraints } from "./ImportMemberKey";
import { isKnownIdentityTypeText } from "./ImportMemberKey";

export interface ArkUiComponentKey {
    componentName: string;
    memberName: string;
    invokeKind: "call";
    argShape: {
        arity: number;
        parameterTypes?: string[];
        returnType?: string;
        literalKinds?: Array<{ index: number; kind: string }>;
        literalValues?: Array<{ index: number; value: string | number | boolean | null }>;
        objectKeys?: Array<{ index: number; keys: string[] }>;
        callbackPositions?: number[];
        spreadPositions?: number[];
    };
    sourceFile: string;
}

export interface ArkUiComponentCandidateKey {
    componentName: string;
    memberName: string;
    invokeKind: ArkUiComponentKey["invokeKind"];
    arity: number;
}

export interface ArkUiComponentSurfaceKey {
    componentName: string;
    memberName: string;
    invokeKind: ArkUiComponentKey["invokeKind"];
}

export function arkUiComponentCandidateKeyString(key: ArkUiComponentCandidateKey): string {
    return JSON.stringify({
        componentName: key.componentName,
        memberName: key.memberName,
        invokeKind: key.invokeKind,
        arity: key.arity,
    });
}

export function arkUiComponentSurfaceKeyString(key: ArkUiComponentSurfaceKey): string {
    return JSON.stringify({
        componentName: key.componentName,
        memberName: key.memberName,
        invokeKind: key.invokeKind,
    });
}

export function arkUiComponentCandidateKeyFromArkUiComponentKey(key: ArkUiComponentKey): ArkUiComponentCandidateKey {
    return {
        componentName: key.componentName,
        memberName: key.memberName,
        invokeKind: key.invokeKind,
        arity: key.argShape.arity,
    };
}

export function arkUiComponentSurfaceKeyFromArkUiComponentKey(key: ArkUiComponentKey): ArkUiComponentSurfaceKey {
    return {
        componentName: key.componentName,
        memberName: key.memberName,
        invokeKind: key.invokeKind,
    };
}

export function knownShapeConstraintsFromArkUiComponentKey(key: ArkUiComponentKey): KnownShapeConstraints {
    return {
        parameterTypes: (key.argShape.parameterTypes || [])
            .map((type, index) => ({ index, type }))
            .filter(item => isKnownIdentityTypeText(item.type)),
        returnType: isKnownIdentityTypeText(key.argShape.returnType) ? key.argShape.returnType : undefined,
        literalKinds: (key.argShape.literalKinds || [])
            .filter(item => Number.isInteger(item.index) && typeof item.kind === "string" && item.kind.trim().length > 0)
            .map(item => ({ index: item.index, kind: item.kind.trim() })),
        literalValues: (key.argShape.literalValues || [])
            .filter(item => Number.isInteger(item.index) && literalValueIsSupported(item.value))
            .map(item => ({ index: item.index, value: normalizeLiteralValue(item.value) })),
        objectKeys: (key.argShape.objectKeys || [])
            .filter(item => Number.isInteger(item.index) && Array.isArray(item.keys) && item.keys.length > 0)
            .map(item => ({
                index: item.index,
                keys: [...new Set(item.keys.map(keyText => String(keyText || "").trim()).filter(Boolean))].sort(),
            }))
            .filter(item => item.keys.length > 0),
        callbackPositions: [...new Set((key.argShape.callbackPositions || [])
            .filter(index => Number.isInteger(index) && index >= 0))]
            .sort((left, right) => left - right),
        spreadPositions: [...new Set((key.argShape.spreadPositions || [])
            .filter(index => Number.isInteger(index) && index >= 0))]
            .sort((left, right) => left - right),
    };
}

function literalValueIsSupported(value: unknown): value is string | number | boolean | null {
    return value === null
        || typeof value === "string"
        || typeof value === "number"
        || typeof value === "boolean";
}

function normalizeLiteralValue(value: string | number | boolean | null): string | number | boolean | null {
    return typeof value === "string" ? value.trim() : value;
}
