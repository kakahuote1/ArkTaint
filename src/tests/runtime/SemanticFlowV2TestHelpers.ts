import type { AssetDocumentBase, AssetPlane } from "../../core/assets/schema";

export function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

export function expectThrows(fn: () => unknown, contains: string): void {
    try {
        fn();
    } catch (error) {
        const text = String((error as any)?.message || error);
        assert(text.includes(contains), `expected "${contains}", got "${text}"`);
        return;
    }
    throw new Error(`expected error containing "${contains}"`);
}

export function makeRuleAsset(
    id = "asset.project.logger.sink",
    plane: AssetPlane = "rule",
): AssetDocumentBase {
    return {
        id,
        plane,
        status: "llm-generated",
        surfaces: [
            {
                surfaceId: `${id}.surface`,
                kind: "invoke",
                modulePath: "project/Logger",
                ownerName: "Logger",
                methodName: "info",
                invokeKind: "static",
                argCount: 1,
                confidence: "likely",
                provenance: {
                    source: "llm-proposal",
                    location: { file: "Logger.ets", line: 1 },
                },
            },
        ],
        bindings: [
            {
                bindingId: `${id}.binding`,
                surfaceId: `${id}.surface`,
                assetId: id,
                plane,
                role: "sink",
                endpoint: { base: { kind: "arg", index: 0 } },
                effectTemplateRefs: [`${id}.effect`],
                semanticsFamily: "logging",
                completeness: "partial",
                confidence: "likely",
            },
        ],
        effectTemplates: [
            {
                id: `${id}.effect`,
                kind: "rule.sink",
                value: { base: { kind: "arg", index: 0 } },
                sinkKind: "logging",
                confidence: "likely",
            },
        ],
        provenance: {
            source: "llm",
            projectId: "project-a",
            evidenceLocations: [{ file: "Logger.ets", line: 1 }],
        },
    };
}

export function makeHandoffAsset(id = "asset.project.token-cache"): AssetDocumentBase {
    return {
        id,
        plane: "module",
        status: "llm-generated",
        surfaces: [
            {
                surfaceId: `${id}.save.surface`,
                kind: "invoke",
                modulePath: "project/TokenCache",
                ownerName: "TokenCache",
                methodName: "save",
                invokeKind: "static",
                argCount: 2,
                confidence: "likely",
                provenance: {
                    source: "llm-proposal",
                    location: { file: "TokenCache.ets", line: 3 },
                },
            },
        ],
        bindings: [
            {
                bindingId: `${id}.save.binding`,
                surfaceId: `${id}.save.surface`,
                assetId: id,
                plane: "module",
                role: "handoff",
                endpoint: { base: { kind: "arg", index: 1 } },
                effectTemplateRefs: [`${id}.save.put`],
                completeness: "partial",
                confidence: "likely",
            },
        ],
        effectTemplates: [
            {
                id: `${id}.save.put`,
                kind: "handoff.put",
                handle: {
                    cellKind: "keyed-semantic-slot",
                    family: "project.token_cache",
                    key: [{ kind: "fromLiteralArg", index: 0 }],
                },
                value: { base: { kind: "arg", index: 1 } },
                updateStrength: "infer",
                confidence: "likely",
            },
        ],
        provenance: {
            source: "llm",
            projectId: "project-a",
            evidenceLocations: [{ file: "TokenCache.ets", line: 3 }],
        },
    };
}
