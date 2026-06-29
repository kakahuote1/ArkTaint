import type { ArkMethod } from "../../../arkanalyzer/out/src/core/model/ArkMethod";
import type {
    AssetDocumentBase,
    AssetEndpoint,
    AssetSurface,
    SemanticEffectTemplate,
} from "../../core/assets/schema";
import type { ApiEffectIdentity, ApiEffectRole } from "../../core/api/ApiOccurrenceIdentity";
import {
    canonicalApiDescriptorFromTestDeclaration,
    indexedTestParameters,
} from "./CanonicalApiTestDeclarations";
import type { ArkanalyzerMethodKey, CanonicalApiDescriptor } from "../../core/api/identity";

export interface TestApiEffectAsset {
    apiEffect: ApiEffectIdentity;
    asset: AssetDocumentBase;
    canonicalApiDescriptor: CanonicalApiDescriptor;
}

export function projectApiEffectAssetFromMethod(input: {
    id: string;
    role: Extract<ApiEffectRole, "source" | "sink" | "transfer">;
    method: ArkMethod;
    endpoint: AssetEndpoint;
    sourceKind?: string;
    sinkKind?: string;
}): TestApiEffectAsset {
    const declaration = projectDeclarationFromArkMethod(input.method);
    const canonicalApiDescriptor = canonicalApiDescriptorFromTestDeclaration({
        authority: "project",
        domain: "local",
        moduleSpecifier: declaration.file,
        logicalDeclarationFile: declaration.file,
        exportPath: declaration.exportPath,
        declarationOwner: declaration.declarationOwner,
        member: declaration.member,
        invoke: { kind: "call" },
        signature: {
            parameters: indexedTestParameters(declaration.parameterTypes),
            returnType: { text: declaration.returnType },
        },
        arkanalyzer: declaration.arkanalyzerMethodKey,
    });
    const canonicalApiId = canonicalApiDescriptor.canonicalApiId;
    const assetId = `asset.test.${input.id}`;
    const surfaceId = `surface.test.${input.id}`;
    const bindingId = `binding.test.${input.id}`;
    const effectTemplateId = `template.test.${input.id}`;
    const surface: AssetSurface = {
        surfaceId,
        kind: "invoke",
        canonicalApiId,
        evidence: {
            arkanalyzer: {
                methodKey: declaration.arkanalyzerMethodKey,
            },
        },
        confidence: "certain",
        provenance: { source: "manual" },
    } as AssetSurface;
    const template = effectTemplateFor(input.role, effectTemplateId, input.endpoint, input.sourceKind, input.sinkKind);
    return {
        apiEffect: {
            canonicalApiId,
            assetId,
            surfaceId,
            bindingId,
            effectTemplateId,
            role: input.role,
        },
        asset: {
            id: assetId,
            plane: "rule",
            status: "reviewed",
            surfaces: [surface],
            bindings: [{
                bindingId,
                surfaceId,
                assetId,
                plane: "rule",
                role: input.role,
                canonicalApiId,
                endpoint: input.endpoint,
                effectTemplateRefs: [effectTemplateId],
                semanticsFamily: `test-${input.role}`,
                completeness: "complete",
                confidence: "certain",
            }],
            effectTemplates: [template],
            provenance: { source: "project" },
        },
        canonicalApiDescriptor,
    };
}

function effectTemplateFor(
    role: Extract<ApiEffectRole, "source" | "sink" | "transfer">,
    id: string,
    endpoint: AssetEndpoint,
    sourceKind?: string,
    sinkKind?: string,
): SemanticEffectTemplate {
    if (role === "source") {
        return {
            id,
            kind: "rule.source",
            value: endpoint,
            sourceKind: (sourceKind || "call_return") as any,
            confidence: "certain",
        };
    }
    if (role === "sink") {
        return {
            id,
            kind: "rule.sink",
            value: endpoint,
            sinkKind: sinkKind || "test",
            confidence: "certain",
        };
    }
    return {
        id,
        kind: "rule.transfer",
        from: { base: { kind: "arg", index: 0 } },
        to: endpoint,
        transferKind: "test",
        confidence: "certain",
    };
}

function projectDeclarationFromArkMethod(method: ArkMethod): {
    file: string;
    ownerName: string;
    fileLevelOwner: boolean;
    exportPath: Array<{ kind: "default" | "namespace"; name: string }>;
    declarationOwner: {
        kind: "namespace" | "class";
        path: string[];
        normalizedName: string;
    };
    member: {
        kind: "function" | "method";
        name: string;
        static?: boolean;
    };
    parameterTypes: string[];
    returnType: string;
    arkanalyzerMethodKey: ArkanalyzerMethodKey;
} {
    const signature = method.getSignature?.();
    const subSignature = signature?.getMethodSubSignature?.();
    const declaringClass = method.getDeclaringArkClass?.();
    const classSignature = declaringClass?.getSignature?.();
    const declaringFileName = String(
        classSignature?.getDeclaringFileSignature?.()?.toString?.()
        || method.getDeclaringArkFile?.()?.getFileSignature?.()?.toString?.()
        || extractFilePathFromSignature(signature?.toString?.() || ""),
    );
    const file = String(
        declaringFileName,
    ).replace(/\\/g, "/").replace(/^@/, "").replace(/:\s*$/, "");
    const methodName = String(
        subSignature?.getMethodName?.()
        || method.getName?.()
        || extractMethodNameFromSignature(signature?.toString?.() || ""),
    ).trim();
    const className = String(
        classSignature?.getClassName?.()
        || declaringClass?.getName?.()
        || "",
    ).trim();
    const namespacePath = namespacePathFromClassSignature(classSignature);
    const fileLevelOwner = !className || className === "%dflt";
    const namespaceOwner = fileLevelOwner && namespacePath.length > 0;
    const ownerName = namespaceOwner
        ? namespacePath[namespacePath.length - 1]
        : fileLevelOwner
            ? "file"
            : className;
    const parameterTypes = (subSignature?.getParameters?.() || []).map((param: unknown) => typeTextOf(param));
    const returnType = typeTextOf(subSignature?.getReturnType?.());
    const arkanalyzerMethodKey: ArkanalyzerMethodKey = {
        declaringFileName,
        declaringNamespacePath: namespacePath,
        declaringClassName: className,
        methodName,
        parameterTypes,
        returnType,
        staticFlag: !!(method as any).isStatic?.(),
    };
    return {
        file,
        ownerName,
        fileLevelOwner,
        exportPath: namespaceOwner
            ? namespacePath.map(name => ({ kind: "namespace" as const, name }))
            : [fileLevelOwner
                ? { kind: "default", name: "file" }
                : { kind: "namespace", name: ownerName }],
        declarationOwner: namespaceOwner
            ? { kind: "namespace", path: namespacePath, normalizedName: namespacePath.join(".") }
            : fileLevelOwner
                ? { kind: "namespace", path: ["file"], normalizedName: "file" }
                : { kind: "class", path: [...namespacePath, ownerName], normalizedName: ownerName },
        member: fileLevelOwner
            ? { kind: "function", name: methodName }
            : { kind: "method", name: methodName, static: !!(method as any).isStatic?.() },
        parameterTypes,
        returnType,
        arkanalyzerMethodKey,
    };
}

function typeTextOf(value: any): string {
    return String(value?.getType?.()?.toString?.() || value?.toString?.() || "unknown").trim() || "unknown";
}

function extractFilePathFromSignature(signature: string): string {
    const match = /^@([^:]+):/.exec(String(signature || ""));
    return match?.[1] || "tests/api/synthetic.ets";
}

function extractMethodNameFromSignature(signature: string): string {
    const match = /\.([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/.exec(String(signature || ""));
    return match?.[1] || "synthetic";
}

function namespacePathFromClassSignature(classSignature: any): string[] {
    const namespaceSignature = classSignature?.getDeclaringNamespaceSignature?.();
    const text = String(namespaceSignature?.toString?.() || "")
        .replace(/\\/g, "/")
        .replace(/:\s*$/g, "")
        .trim();
    if (!text) return [];
    const colon = text.lastIndexOf(":");
    const namespaceText = (colon >= 0 ? text.slice(colon + 1) : text).trim();
    if (!namespaceText || namespaceText === "%dflt") return [];
    return namespaceText
        .split(".")
        .map(part => part.trim())
        .filter(part => part.length > 0 && part !== "%dflt");
}
