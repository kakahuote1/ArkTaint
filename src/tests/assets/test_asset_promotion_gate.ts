import * as path from "path";
import type { AssetDocumentBase } from "../../core/assets/schema";
import {
    assertProjectAssetsArePromotedForModelRoot,
    promoteAssetThroughGate,
} from "../../core/assets/schema";
import { exactProjectInvokeSurface } from "../helpers/AssetIdentityTestUtils";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function expectThrows(fn: () => unknown, contains: string): void {
    try {
        fn();
    } catch (error) {
        const text = String((error as any)?.message || error);
        assert(text.includes(contains), `expected "${contains}", got "${text}"`);
        return;
    }
    throw new Error(`expected error containing "${contains}"`);
}

function candidateAsset(): AssetDocumentBase {
    const asset = {
        id: "asset.project.token-cache",
        plane: "module",
        status: "llm-generated",
        surfaces: [
            exactProjectInvokeSurface({
                surfaceId: "surface.TokenCache.save",
                modulePath: "project/cache",
                ownerName: "TokenCache",
                methodName: "save",
                invokeKind: "static",
                parameterTypes: ["string", "Object"],
                returnType: "void",
                confidence: "likely",
                provenanceSource: "llm-proposal",
            }),
        ],
        bindings: [
            {
                bindingId: "binding.TokenCache.save",
                surfaceId: "surface.TokenCache.save",
                assetId: "asset.project.token-cache",
                plane: "module",
                role: "handoff",
                canonicalApiId: undefined,
                effectTemplateRefs: ["template.TokenCache.save.put"],
                completeness: "partial",
                confidence: "likely",
            },
        ],
        effectTemplates: [
            {
                id: "template.TokenCache.save.put",
                kind: "handoff.put",
                handle: {
                    cellKind: "keyed-semantic-slot",
                    family: "project.token_cache",
                    key: [{ kind: "fromLiteralArg", index: 0 }],
                    precision: "exact",
                },
                value: { base: { kind: "arg", index: 1 } },
                updateStrength: "weak",
                confidence: "likely",
            },
        ],
        provenance: { source: "llm", projectId: "demo", evidenceLocations: [{ file: "TokenCache.ets", line: 2 }] },
    } as AssetDocumentBase;
    asset.bindings[0].canonicalApiId = asset.surfaces[0].canonicalApiId;
    return asset;
}

function main(): void {
    const asset = candidateAsset();
    const missingAnchor = promoteAssetThroughGate({
        asset,
        targetStatus: "reviewed",
        analyzerBackedSurfaceIds: new Set<string>(),
        reviewedBy: "reviewer",
    });
    assert(!missingAnchor.accepted, "promotion without analyzer-backed surfaces must fail");
    assert(missingAnchor.errors.some(error => error.includes("not analyzer-backed")), "expected analyzer-backed error");

    const reviewed = promoteAssetThroughGate({
        asset,
        targetStatus: "reviewed",
        analyzerBackedSurfaceIds: new Set(["surface.TokenCache.save"]),
        reviewedBy: "reviewer",
        projectId: "demo",
    });
    assert(reviewed.accepted && reviewed.asset, "valid promotion should pass");
    assert(reviewed.asset.status === "reviewed", "promoted asset must become reviewed");
    assert(reviewed.asset.provenance.source === "manual", "LLM provenance must not stay as direct source after promotion");
    assert(reviewed.asset.surfaces[0].provenance.source === "analyzer", "promoted surface must be analyzer-backed");

    const replayed = promoteAssetThroughGate({
        asset: reviewed.asset,
        targetStatus: "replayed",
        analyzerBackedSurfaceIds: new Set(["surface.TokenCache.save"]),
        reviewedBy: "reviewer",
        replayedBy: "replay-run",
        projectId: "demo",
    });
    assert(replayed.accepted && replayed.asset?.status === "replayed", "reviewed asset should promote to replayed with replay evidence");

    const replayedWithoutEvidence = promoteAssetThroughGate({
        asset: reviewed.asset,
        targetStatus: "replayed",
        analyzerBackedSurfaceIds: new Set(["surface.TokenCache.save"]),
        reviewedBy: "reviewer",
    });
    assert(!replayedWithoutEvidence.accepted, "replayed promotion must require replayedBy");

    const formalRoot = path.resolve("src/models");
    expectThrows(() => assertProjectAssetsArePromotedForModelRoot(formalRoot, [asset]), "reviewed/replayed status");
    assertProjectAssetsArePromotedForModelRoot(path.resolve("tmp/project_modeling_candidates/demo"), [asset]);
    assertProjectAssetsArePromotedForModelRoot(formalRoot, [reviewed.asset]);

    console.log("PASS test_asset_promotion_gate");
}

main();
