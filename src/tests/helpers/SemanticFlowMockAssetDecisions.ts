import type { AssetDocumentBase } from "../../core/assets/schema";

export function resolvedAsset(asset: AssetDocumentBase): Record<string, unknown> {
    return {
        status: "done",
        asset,
        rationale: [`resolved ${asset.id}`],
    };
}

export function withSurfaceModulePath(
    asset: AssetDocumentBase,
    modulePath: string | undefined,
    sourceFile?: string,
): AssetDocumentBase {
    if (!modulePath) {
        return asset;
    }
    return {
        ...asset,
        surfaces: (asset.surfaces || []).map(surface => surface.kind === "invoke"
            ? {
                ...surface,
                modulePath,
                provenance: {
                    ...(surface.provenance || {}),
                    source: surface.provenance.source,
                    location: sourceFile ? { file: sourceFile } : surface.provenance?.location,
                },
            }
            : surface),
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
    return {
        id,
        plane: "module",
        status: "llm-generated",
        surfaces: [
            {
                surfaceId: `${id}.put.surface`,
                kind: "invoke",
                modulePath: "project/Vault",
                ownerName: "Vault",
                methodName: "put",
                invokeKind: "instance",
                argCount: 2,
                confidence: "likely",
                provenance: { source: "llm-proposal", location: { file: "Vault.ets" } },
            },
            {
                surfaceId: `${id}.get.surface`,
                kind: "invoke",
                modulePath: "project/Vault",
                ownerName: "Vault",
                methodName: "get",
                invokeKind: "instance",
                argCount: 1,
                confidence: "likely",
                provenance: { source: "llm-proposal", location: { file: "Vault.ets" } },
            },
        ],
        bindings: [
            {
                bindingId: `${id}.put.binding`,
                surfaceId: `${id}.put.surface`,
                assetId: id,
                plane: "module",
                role: "handoff",
                endpoint: { base: { kind: "arg", index: 1 } },
                effectTemplateRefs: [`${id}.put.effect`],
                semanticsFamily: "project-keyed-storage",
                completeness: "partial",
                confidence: "likely",
            },
            {
                bindingId: `${id}.get.binding`,
                surfaceId: `${id}.get.surface`,
                assetId: id,
                plane: "module",
                role: "handoff",
                endpoint: { base: { kind: "return" } },
                effectTemplateRefs: [`${id}.get.effect`],
                semanticsFamily: "project-keyed-storage",
                completeness: "partial",
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
                    precision: "infer",
                },
                value: { base: { kind: "arg", index: 1 } },
                updateStrength: "infer",
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
                    precision: "infer",
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
    return {
        id,
        plane: "rule",
        status: "llm-generated",
        surfaces: [{
            surfaceId: `${id}.surface`,
            kind: "invoke",
            modulePath: `project/${owner}`,
            ownerName: owner,
            methodName,
            invokeKind: "instance",
            argCount,
            confidence: "likely",
            provenance: { source: "llm-proposal", location: { file: `${owner}.ets` } },
        }],
        bindings: [{
            bindingId: `${id}.binding`,
            surfaceId: `${id}.surface`,
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
