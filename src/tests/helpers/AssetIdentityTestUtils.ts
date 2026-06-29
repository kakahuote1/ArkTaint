import type { ConstructSurface, InvokeSurface } from "../../core/assets/schema";
import { fromOfficialDeclaration, fromProjectDeclaration } from "../../core/api/identity";
import type { ApiDomain } from "../../core/api/identity/CanonicalApiDescriptor";

const LEGACY_SURFACE_KEYS = [
    "runtimeShape",
    "modulePath",
    "ownerName",
    "functionName",
    "methodName",
    "className",
    "propertyName",
    "decoratorName",
    "ownerKind",
    "fieldName",
    "phase",
    "entryKind",
    "invokeKind",
    "argCount",
    "parameterTypes",
    "returnType",
    "signatureId",
    "callee_signature",
    "sourceFile",
];

export function bindExactAssetIdentities<T extends {
    surfaces?: Array<Record<string, any>>;
    bindings?: Array<Record<string, any>>;
}>(asset: T): T {
    const surfaceCanonicalIds = new Map<string, string>();
    for (const surface of asset.surfaces || []) {
        assertNoLegacySurfaceKeys(surface);
        const canonicalApiId = surface.canonicalApiId;
        if (!canonicalApiId) {
            throw new Error(`test asset surface ${surface.surfaceId || "<missing>"} has no canonicalApiId`);
        }
        if (!surface.surfaceId) {
            throw new Error(`test asset surface with canonicalApiId ${canonicalApiId} has no surfaceId`);
        }
        surface.canonicalApiId = canonicalApiId;
        surfaceCanonicalIds.set(surface.surfaceId, canonicalApiId);
    }
    for (const binding of asset.bindings || []) {
        const canonicalApiId = surfaceCanonicalIds.get(binding.surfaceId);
        if (!canonicalApiId) {
            throw new Error(`test asset binding ${binding.bindingId || "<missing>"} references unknown surface ${binding.surfaceId || "<missing>"}`);
        }
        if (binding.canonicalApiId && binding.canonicalApiId !== canonicalApiId) {
            throw new Error(`test asset binding ${binding.bindingId || "<missing>"} canonicalApiId does not match surface ${binding.surfaceId}`);
        }
        binding.canonicalApiId = canonicalApiId;
    }
    return asset;
}

function assertNoLegacySurfaceKeys(surface: Record<string, any>): void {
    const legacyKey = LEGACY_SURFACE_KEYS.find(key => Object.prototype.hasOwnProperty.call(surface, key));
    if (legacyKey) {
        throw new Error(`test asset surface ${surface.surfaceId || "<missing>"} uses legacy top-level ${legacyKey}; use an exact surface helper`);
    }
}

export function exactProjectInvokeSurface(input: {
    surfaceId: string;
    modulePath: string;
    ownerName?: string;
    methodName?: string;
    functionName?: string;
    invokeKind?: "instance" | "static" | "namespace" | "free-function";
    argCount?: number;
    parameterTypes?: string[];
    returnType?: string;
    confidence?: InvokeSurface["confidence"];
    provenanceSource?: InvokeSurface["provenance"]["source"];
    provenance?: InvokeSurface["provenance"];
}): InvokeSurface {
    const invokeKind = input.invokeKind || (input.functionName && !input.ownerName ? "free-function" : "static");
    const parameterTypes = input.parameterTypes || [];
    const returnType = input.returnType || "void";
    const freeFunction = invokeKind === "free-function";
    const memberName = freeFunction ? (input.functionName || input.methodName) : input.methodName;
    const descriptorOwnerName = freeFunction ? (input.ownerName || "file") : input.ownerName;
    const arkanalyzerOwnerName = freeFunction ? (input.ownerName || "%dflt") : input.ownerName;
    if (!memberName) {
        throw new Error(`exact project surface ${input.surfaceId} is missing a methodName or functionName`);
    }
    if (!descriptorOwnerName || !arkanalyzerOwnerName) {
        throw new Error(`exact project surface ${input.surfaceId} is missing an ownerName`);
    }
    const file = syntheticDeclarationFile(input.modulePath);
    const canonicalApiId = canonicalApiIdFromProjectDeclaration({
        modulePath: input.modulePath,
        ownerName: descriptorOwnerName,
        arkanalyzerOwnerName,
        methodName: freeFunction ? undefined : memberName,
        functionName: freeFunction ? memberName : undefined,
        invokeKind,
        exportKind: invokeKind === "free-function" ? "named" : "namespace",
        exportName: invokeKind === "free-function" ? memberName : descriptorOwnerName,
        parameterTypes,
        returnType,
    });
    return {
        surfaceId: input.surfaceId,
        kind: "invoke",
        canonicalApiId,
        evidence: {
            arkanalyzer: {
                methodKey: {
                    declaringFileName: file,
                    declaringNamespacePath: [],
                    declaringClassName: arkanalyzerOwnerName,
                    methodName: memberName,
                    parameterTypes,
                    returnType,
                    staticFlag: invokeKind === "static" || invokeKind === "namespace" || invokeKind === "free-function",
                },
            },
        },
        confidence: input.confidence || "certain",
        provenance: input.provenance || { source: input.provenanceSource || "manual" },
    };
}

export function exactProjectConstructSurface(input: {
    surfaceId: string;
    modulePath: string;
    ownerName: string;
    argCount?: number;
    parameterTypes?: string[];
    returnType?: string;
    confidence?: ConstructSurface["confidence"];
    provenanceSource?: ConstructSurface["provenance"]["source"];
    provenance?: ConstructSurface["provenance"];
}): ConstructSurface {
    const parameterTypes = input.parameterTypes || [];
    const returnType = input.returnType || "void";
    const file = syntheticDeclarationFile(input.modulePath);
    const canonicalApiId = canonicalApiIdFromProjectDeclaration({
        modulePath: input.modulePath,
        ownerName: input.ownerName,
        construct: true,
        parameterTypes,
        returnType,
    });
    return {
        surfaceId: input.surfaceId,
        kind: "construct",
        canonicalApiId,
        evidence: {
            arkanalyzer: {
                methodKey: {
                    declaringFileName: file,
                    declaringNamespacePath: [],
                    declaringClassName: input.ownerName,
                    methodName: "constructor",
                    parameterTypes,
                    returnType,
                    staticFlag: true,
                },
            },
        },
        confidence: input.confidence || "certain",
        provenance: input.provenance || { source: input.provenanceSource || "manual" },
    };
}

export function exactOfficialInvokeSurface(input: {
    surfaceId: string;
    domain?: ApiDomain;
    moduleSpecifier: string;
    logicalDeclarationFile?: string;
    exportName: string;
    ownerName: string;
    methodName: string;
    invokeKind?: "instance" | "static" | "namespace" | "free-function";
    parameterTypes?: string[];
    returnType?: string;
    confidence?: InvokeSurface["confidence"];
    provenanceSource?: InvokeSurface["provenance"]["source"];
}): InvokeSurface {
    const invokeKind = input.invokeKind || "static";
    const parameterTypes = input.parameterTypes || [];
    const returnType = input.returnType || "void";
    const ownerKind = invokeKind === "instance" || invokeKind === "static" ? "class" : "namespace";
    const memberKind = invokeKind === "instance" || invokeKind === "static" ? "method" : "function";
    const logicalDeclarationFile = input.logicalDeclarationFile || `api/${input.moduleSpecifier}.d.ts`;
    const result = fromOfficialDeclaration({
        domain: input.domain || "openharmony",
        moduleSpecifier: input.moduleSpecifier,
        logicalDeclarationFile,
        exportPath: [{ kind: invokeKind === "free-function" ? "named" : "namespace", name: input.exportName }],
        declarationOwner: {
            kind: ownerKind,
            path: [input.ownerName],
            normalizedName: input.ownerName,
            arkanalyzerName: input.ownerName,
        },
        member: memberKind === "method"
            ? { kind: "method", name: input.methodName, static: invokeKind === "static" }
            : { kind: "function", name: input.methodName },
        invoke: { kind: "call" },
        signature: {
            parameters: parameterTypes.map((type, index) => {
                const text = String(type || "");
                if (text.startsWith("rest:")) {
                    return { index, rest: true, type: { text: text.slice("rest:".length) } };
                }
                return { index, type: { text } };
            }),
            returnType: { text: returnType },
        },
        arkanalyzer: {
            declaringFileName: logicalDeclarationFile,
            declaringNamespacePath: [],
            declaringClassName: input.ownerName,
            methodName: input.methodName,
            parameterTypes,
            returnType,
            staticFlag: invokeKind === "static" || invokeKind === "namespace" || invokeKind === "free-function",
        },
        declarationLocations: [{ file: logicalDeclarationFile }],
    });
    if (result.status !== "accepted") {
        throw new Error(`official fixture canonical identity rejected for ${input.ownerName}.${input.methodName}: ${result.reason}`);
    }
    return {
        surfaceId: input.surfaceId,
        kind: "invoke",
        canonicalApiId: result.descriptor.canonicalApiId,
        evidence: {
            arkanalyzer: {
                methodKey: {
                    declaringFileName: logicalDeclarationFile,
                    declaringNamespacePath: [],
                    declaringClassName: input.ownerName,
                    methodName: input.methodName,
                    parameterTypes,
                    returnType,
                    staticFlag: invokeKind === "static" || invokeKind === "namespace" || invokeKind === "free-function",
                },
            },
        },
        confidence: input.confidence || "certain",
        provenance: { source: input.provenanceSource || "sdk" },
    };
}

function canonicalApiIdFromProjectDeclaration(input: {
    modulePath: string;
    ownerName?: string;
    arkanalyzerOwnerName?: string;
    functionName?: string;
    methodName?: string;
    invokeKind?: string;
    exportKind?: "default" | "namespace" | "named";
    exportName?: string;
    parameterTypes?: string[];
    returnType: string;
    construct?: boolean;
    access?: boolean;
}): string {
    const ownerName = input.ownerName || input.functionName || "TestFixture";
    const arkanalyzerOwnerName = input.arkanalyzerOwnerName || ownerName;
    const memberName = input.methodName || input.functionName || "apply";
    const file = syntheticDeclarationFile(input.modulePath);
    const memberKind = input.access ? "property" : (input.construct ? "constructor" : ((input.invokeKind === "namespace" || input.invokeKind === "free-function") ? "function" : "method"));
    const exportKind = input.exportKind || (input.invokeKind === "free-function" ? "named" : "namespace");
    const exportName = input.exportName || (exportKind === "default" ? "default" : ownerName);
    const result = fromProjectDeclaration({
        domain: "local",
        moduleSpecifier: input.modulePath,
        logicalDeclarationFile: file,
        exportPath: [{ kind: exportKind, name: exportName }],
        declarationOwner: {
            kind: memberKind === "method" || memberKind === "constructor" ? "class" : "namespace",
            path: [ownerName],
            normalizedName: ownerName,
            arkanalyzerName: arkanalyzerOwnerName,
        },
        member: memberKind === "method"
            ? { kind: "method", name: memberName, static: input.invokeKind === "static" }
            : (memberKind === "constructor"
                ? { kind: "constructor", name: "constructor" }
                : { kind: memberKind, name: memberName }),
        invoke: { kind: input.access ? "property-read" : (input.construct ? "new" : "call") },
        signature: {
            parameters: (input.parameterTypes || []).map((type, index) => ({ index, type: { text: type } })),
            returnType: { text: input.returnType },
        },
        arkanalyzer: input.access ? undefined : {
            declaringFileName: file,
            declaringNamespacePath: [],
            declaringClassName: arkanalyzerOwnerName,
            methodName: memberName,
            parameterTypes: input.parameterTypes || [],
            returnType: input.returnType,
            staticFlag: input.invokeKind === "static",
        },
        declarationLocations: [{ file }],
    });
    if (result.status !== "accepted") {
        throw new Error(`test asset canonical identity rejected for ${ownerName}.${memberName}: ${result.reason}`);
    }
    return result.descriptor.canonicalApiId;
}

function syntheticDeclarationFile(modulePath: string): string {
    const safe = String(modulePath || "test-fixture")
        .replace(/^@/, "")
        .replace(/[^A-Za-z0-9_.-]+/g, "_")
        .replace(/^_+|_+$/g, "") || "test_fixture";
    return `tests/api/${safe}.d.ts`;
}
