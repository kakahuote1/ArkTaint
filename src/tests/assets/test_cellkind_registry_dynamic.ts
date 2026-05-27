import type { AssetDocumentBase } from "../../core/assets/schema";
import { promoteAssetThroughGate, validateAssetDocument } from "../../core/assets/schema";
import {
    CellKindRegistry,
    DEFAULT_CELL_KIND_REGISTRY,
    type CellKindSpec,
} from "../../core/cellkind";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function expectThrows(fn: () => unknown, contains: string): void {
    try {
        fn();
    } catch (error) {
        const text = String((error as any)?.message || error);
        assert(text.includes(contains), `expected error containing "${contains}", got "${text}"`);
        return;
    }
    throw new Error(`expected error containing "${contains}"`);
}

const customCellKind: CellKindSpec = {
    id: "developer-secure-cache-slot",
    category: "semantic-location",
    description: "Developer supplied keyed cache slot used by project or LLM model assets.",
    requiredDimensions: ["owner", "key"],
    optionalDimensions: ["scope", "fieldPath"],
    allowedEffects: ["store", "load", "store-clean", "kill", "link", "unlink"],
    compatibilityPolicy: "canonical-dimensions",
    updatePolicy: "strong-when-exact",
    linkPolicy: "explicit-link",
};

function dynamicModelAsset(
    id: string,
    surfaceId: string,
    methodName: string,
    templateId: string,
): AssetDocumentBase {
    return {
        id,
        plane: "module",
        status: "llm-generated",
        surfaces: [
            {
                surfaceId,
                kind: "invoke",
                modulePath: "project/secure-cache",
                ownerName: "SecureCache",
                methodName,
                invokeKind: "static",
                argCount: 2,
                confidence: "likely",
                provenance: {
                    source: "llm-proposal",
                    location: { file: "SecureCache.ets", line: 10 },
                },
            },
        ],
        bindings: [
            {
                bindingId: `${id}.binding`,
                surfaceId,
                assetId: id,
                plane: "module",
                role: "handoff",
                effectTemplateRefs: [templateId],
                semanticsFamily: "project-secure-cache",
                completeness: "partial",
                confidence: "likely",
            },
        ],
        effectTemplates: [
            {
                id: templateId,
                kind: "handoff.put",
                handle: {
                    cellKind: "developer-secure-cache-slot",
                    family: "project.secure_cache",
                    owner: [{ kind: "const", value: "SecureCache" }],
                    key: [{ kind: "fromLiteralArg", index: 0 }],
                    precision: "infer",
                },
                value: { base: { kind: "arg", index: 1 } },
                updateStrength: "infer",
                confidence: "likely",
            },
        ],
        provenance: {
            source: "llm",
            projectId: "dynamic-cellkind-demo",
            evidenceLocations: [{ file: "SecureCache.ets", line: 10 }],
        },
    };
}

function main(): void {
    const firstAsset = dynamicModelAsset(
        "asset.project.secure-cache.put",
        "surface.SecureCache.put",
        "put",
        "template.SecureCache.put",
    );
    const secondAsset = dynamicModelAsset(
        "asset.project.session-cache.put",
        "surface.SessionCache.put",
        "putSession",
        "template.SessionCache.put",
    );

    const defaultValidation = validateAssetDocument(firstAsset);
    assert(!defaultValidation.valid, "unregistered custom cellKind must fail default validation");
    assert(
        defaultValidation.errors.some(error => error.includes("cellKind is not a registered CellKindId")),
        `expected cellKind validation error, got ${defaultValidation.errors.join("; ")}`,
    );

    const registry = new CellKindRegistry([
        ...DEFAULT_CELL_KIND_REGISTRY.all(),
        customCellKind,
    ]);
    assert(registry.has("developer-secure-cache-slot"), "custom cellKind must be dynamically registered");

    const customValidation = validateAssetDocument(firstAsset, { cellKindRegistry: registry });
    assert(customValidation.valid, `custom registered cellKind should validate: ${customValidation.errors.join("; ")}`);

    const secondValidation = validateAssetDocument(secondAsset, { cellKindRegistry: registry });
    assert(secondValidation.valid, "multiple model assets must be able to bind to the same custom cellKind");

    const rejectedPromotion = promoteAssetThroughGate({
        asset: firstAsset,
        targetStatus: "reviewed",
        analyzerBackedSurfaceIds: new Set(["surface.SecureCache.put"]),
        reviewedBy: "reviewer",
        projectId: "dynamic-cellkind-demo",
    });
    assert(!rejectedPromotion.accepted, "promotion without the dynamic registry must reject the custom cellKind");

    const acceptedPromotion = promoteAssetThroughGate({
        asset: firstAsset,
        targetStatus: "reviewed",
        analyzerBackedSurfaceIds: new Set(["surface.SecureCache.put"]),
        reviewedBy: "reviewer",
        projectId: "dynamic-cellkind-demo",
        cellKindRegistry: registry,
    });
    assert(acceptedPromotion.accepted && acceptedPromotion.asset?.status === "reviewed", "promotion must accept registered custom cellKind");

    expectThrows(
        () => new CellKindRegistry([...DEFAULT_CELL_KIND_REGISTRY.all(), customCellKind, customCellKind]),
        "duplicate CellKindId",
    );

    console.log("PASS test_cellkind_registry_dynamic");
}

main();
