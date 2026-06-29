import type { AssetDocumentBase, AssetSurface } from "../../core/assets/schema";
import { fromProjectDeclaration } from "../../core/api/identity";

export function resolvedAsset(asset: AssetDocumentBase): Record<string, unknown> {
    return {
        status: "done",
        asset,
        rationale: [`resolved ${asset.id}`],
    };
}

export function retargetAssetSurfacesToProjectModule(
    asset: AssetDocumentBase,
    modulePath: string | undefined,
    sourceFile?: string,
): AssetDocumentBase {
    if (!modulePath) {
        return asset;
    }
    const retargetedSurfaces = (asset.surfaces || []).map(surface => surface.kind === "invoke"
        ? retargetInvokeSurface(surface, modulePath, sourceFile)
        : surface);
    const surfaceIdMap = new Map<string, AssetSurface>();
    for (const surface of retargetedSurfaces) {
        surfaceIdMap.set(surface.surfaceId, surface);
    }
    const oldToNewSurfaceId = new Map<string, string>();
    for (let index = 0; index < (asset.surfaces || []).length; index++) {
        const oldSurface = asset.surfaces![index];
        const newSurface = retargetedSurfaces[index];
        if (oldSurface?.surfaceId && newSurface?.surfaceId) {
            oldToNewSurfaceId.set(oldSurface.surfaceId, newSurface.surfaceId);
        }
    }
    return {
        ...asset,
        surfaces: retargetedSurfaces,
        bindings: (asset.bindings || []).map(binding => {
            const retargetedSurfaceId = oldToNewSurfaceId.get(binding.surfaceId) || binding.surfaceId;
            const retargeted = surfaceIdMap.get(retargetedSurfaceId);
            return {
                ...binding,
                surfaceId: retargetedSurfaceId,
                canonicalApiId: retargeted?.canonicalApiId || binding.canonicalApiId,
            };
        }),
    };
}

export function ruleSourceAsset(owner: string, methodName: string, argCount: number): AssetDocumentBase {
    const id = `asset.test.${owner}.${methodName}.source`;
    return invokeRuleAsset(id, owner, methodName, argCount, "source", {
        id: `${id}.effect`,
        kind: "rule.source",
        value: { base: { kind: "return" } },
        sourceKind: "call_return",
        confidence: "likely",
    });
}

export function ruleSinkAsset(owner: string, methodName: string, argCount: number): AssetDocumentBase {
    const id = `asset.test.${owner}.${methodName}.sink`;
    return invokeRuleAsset(id, owner, methodName, argCount, "sink", {
        id: `${id}.effect`,
        kind: "rule.sink",
        value: { base: { kind: "arg", index: 0 } },
        sinkKind: "logging",
        confidence: "likely",
    });
}

export function ruleTransferAsset(owner: string, methodName: string, argCount: number): AssetDocumentBase {
    const id = `asset.test.${owner}.${methodName}.transfer`;
    return invokeRuleAsset(id, owner, methodName, argCount, "transfer", {
        id: `${id}.effect`,
        kind: "rule.transfer",
        from: { base: { kind: "arg", index: 0 } },
        to: { base: { kind: "return" } },
        transferKind: "direct",
        confidence: "likely",
    });
}

export function vaultHandoffAsset(projectId = "semanticflow_test"): AssetDocumentBase {
    const id = `asset.test.${projectId}.vault.handoff`;
    const putSurface = {
        ...invokeSurface(`${id}.put.surface`, "project/Vault", "Vault", "put", ["string", "SyntheticTaintValue"], "void"),
        confidence: "likely" as const,
    };
    const getSurface = {
        ...invokeSurface(`${id}.get.surface`, "project/Vault", "Vault", "get", ["string"], "SyntheticTaintValue"),
        confidence: "likely" as const,
    };
    return {
        id,
        plane: "module",
        status: "llm-generated",
        surfaces: [putSurface, getSurface],
        bindings: [
            {
                bindingId: `${id}.put.binding`,
                surfaceId: putSurface.surfaceId,
                canonicalApiId: putSurface.canonicalApiId,
                assetId: id,
                plane: "module",
                role: "handoff",
                endpoint: { base: { kind: "arg", index: 1 } },
                effectTemplateRefs: [`${id}.put.effect`],
                semanticsFamily: "project-keyed-storage",
                completeness: "complete",
                confidence: "likely",
            },
            {
                bindingId: `${id}.get.binding`,
                surfaceId: getSurface.surfaceId,
                canonicalApiId: getSurface.canonicalApiId,
                assetId: id,
                plane: "module",
                role: "handoff",
                endpoint: { base: { kind: "return" } },
                effectTemplateRefs: [`${id}.get.effect`],
                semanticsFamily: "project-keyed-storage",
                completeness: "complete",
                confidence: "likely",
            },
        ],
        effectTemplates: [
            {
                id: `${id}.put.effect`,
                kind: "handoff.put",
                handle: {
                    cellKind: "keyed-semantic-slot",
                    family: "project.vault",
                    owner: [{ kind: "const", value: "Vault" }],
                    key: [{ kind: "fromLiteralArg", index: 0 }],
                    precision: "exact",
                },
                value: { base: { kind: "arg", index: 1 } },
                updateStrength: "strong",
                confidence: "likely",
            },
            {
                id: `${id}.get.effect`,
                kind: "handoff.get",
                handle: {
                    cellKind: "keyed-semantic-slot",
                    family: "project.vault",
                    owner: [{ kind: "const", value: "Vault" }],
                    key: [{ kind: "fromLiteralArg", index: 0 }],
                    precision: "exact",
                },
                target: { base: { kind: "return" } },
                confidence: "likely",
            },
        ],
        provenance: { source: "llm", projectId },
    };
}

function invokeRuleAsset(
    id: string,
    owner: string,
    methodName: string,
    argCount: number,
    role: "source" | "sink" | "transfer",
    effect: any,
): AssetDocumentBase {
    const surface = {
        ...invokeSurface(
            `${id}.surface`,
            `project/${owner}`,
            owner,
            methodName,
            Array.from({ length: argCount }, (_unused, index) => `SyntheticArg${index}`),
            role === "source" || role === "transfer" ? "SyntheticTaintValue" : "void",
        ),
        confidence: "likely" as const,
    };
    return {
        id,
        plane: "rule",
        status: "llm-generated",
        surfaces: [surface],
        bindings: [{
            bindingId: `${id}.binding`,
            surfaceId: surface.surfaceId,
            canonicalApiId: surface.canonicalApiId,
            assetId: id,
            plane: "rule",
            role,
            endpoint: role === "source" ? { base: { kind: "return" } } : { base: { kind: "arg", index: 0 } },
            effectTemplateRefs: [`${id}.effect`],
            semanticsFamily: role === "sink" ? "logging" : role === "source" ? "project-source" : "direct-transfer",
            completeness: "partial",
            confidence: "likely",
        }],
        effectTemplates: [effect],
        provenance: { source: "llm", projectId: "semanticflow_test" },
    };
}

function invokeSurface(
    surfaceId: string,
    modulePath: string,
    ownerName: string,
    methodName: string,
    parameterTypes: string[],
    returnType: string,
): AssetSurface {
    const canonicalApiId = canonicalApiIdFromProjectDeclaration(modulePath, ownerName, methodName, parameterTypes, returnType);
    return {
        surfaceId: `surface:${canonicalApiId}`,
        kind: "invoke",
        canonicalApiId,
        evidence: {
            arkanalyzer: {
                methodKey: {
                    declaringFileName: modulePath,
                    declaringNamespacePath: [],
                    declaringClassName: ownerName,
                    methodName,
                    parameterTypes,
                    returnType,
                    staticFlag: false,
                },
            },
        },
        confidence: "likely",
        provenance: { source: "llm-proposal", location: { file: `${ownerName}.ets` } },
    };
}

function retargetInvokeSurface(
    surface: AssetSurface,
    modulePath: string,
    sourceFile?: string,
): AssetSurface {
    const methodKey = surface.evidence?.arkanalyzer?.methodKey;
    if (!methodKey) {
        throw new Error(`cannot retarget ${surface.surfaceId}: missing exact arkanalyzer methodKey`);
    }
    const canonicalApiId = canonicalApiIdFromProjectDeclaration(
        modulePath,
        methodKey.declaringClassName,
        methodKey.methodName,
        methodKey.parameterTypes,
        methodKey.returnType,
    );
    return {
        ...surface,
        surfaceId: `surface:${canonicalApiId}`,
        canonicalApiId,
        evidence: {
            arkanalyzer: {
                methodKey: {
                    ...methodKey,
                    declaringFileName: modulePath,
                },
            },
        },
        provenance: {
            ...(surface.provenance || {}),
            source: surface.provenance.source,
            location: sourceFile ? { file: sourceFile } : surface.provenance?.location,
        },
    };
}

function canonicalApiIdFromProjectDeclaration(
    modulePath: string,
    ownerName: string,
    methodName: string,
    parameterTypes: string[],
    returnType: string,
): string {
    const result = fromProjectDeclaration({
        domain: "local",
        moduleSpecifier: modulePath,
        logicalDeclarationFile: modulePath,
        exportPath: [{ kind: "namespace", name: ownerName }],
        declarationOwner: {
            kind: "class",
            path: [ownerName],
            normalizedName: ownerName,
            arkanalyzerName: ownerName,
        },
        member: { kind: "method", name: methodName, static: false },
        invoke: { kind: "call" },
        signature: {
            parameters: parameterTypes.map((type, index) => ({ index, type: { text: type } })),
            returnType: { text: returnType },
        },
        arkanalyzer: {
            declaringFileName: modulePath,
            declaringNamespacePath: [],
            declaringClassName: ownerName,
            methodName,
            parameterTypes,
            returnType,
            staticFlag: false,
        },
        declarationLocations: [{ file: modulePath }],
    });
    if (result.status !== "accepted") {
        throw new Error(`mock semanticflow canonical identity rejected for ${ownerName}.${methodName}: ${result.reason}`);
    }
    return result.descriptor.canonicalApiId;
}
