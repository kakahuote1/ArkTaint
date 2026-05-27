import {
    bootstrapAssetSurfaceRegistry,
    type AssetDocumentBase,
    type AssetEndpoint,
    resolveAssetIdentity,
} from "../../core/assets/schema";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

const arg0: AssetEndpoint = { base: { kind: "arg", index: 0 } };

function makeAsset(id: string, status: AssetDocumentBase["status"], role: "sink" | "source" = "sink"): AssetDocumentBase {
    const effectId = `template.${id}.${role}`;
    return {
        id,
        plane: "rule",
        status,
        surfaces: [
            {
                surfaceId: `surface.${id}`,
                kind: "invoke",
                modulePath: "@ohos.console",
                ownerName: "console",
                methodName: "log",
                invokeKind: "static",
                argCount: 1,
                confidence: "certain",
                provenance: { source: "sdk" },
            },
        ],
        bindings: [
            {
                bindingId: `binding.${id}.${role}`,
                surfaceId: `surface.${id}`,
                assetId: id,
                plane: "rule",
                role,
                endpoint: arg0,
                effectTemplateRefs: [effectId],
                semanticsFamily: role === "sink" ? "privacy-log" : "debug-source",
                completeness: "complete",
                confidence: "certain",
            },
        ],
        effectTemplates: role === "sink"
            ? [{ id: effectId, kind: "rule.sink", value: arg0, sinkKind: "log", confidence: "certain" }]
            : [{ id: effectId, kind: "rule.source", value: arg0, sourceKind: "callback_param", confidence: "certain" }],
        provenance: { source: status === "official" ? "builtin" : "project" },
    };
}

function identityOf(asset: AssetDocumentBase) {
    const result = resolveAssetIdentity(asset.surfaces[0]);
    assert(result.status === "resolved" && result.identity, `identity should resolve: ${result.reason}`);
    return result.identity;
}

function main(): void {
    const officialSink = makeAsset("asset.official.console.sink", "official", "sink");
    const candidateSource = makeAsset("asset.candidate.console.source", "candidate", "source");
    const reviewedSource = makeAsset("asset.reviewed.console.source", "reviewed", "source");
    const schemaValidSink = makeAsset("asset.schema-valid.console.sink", "schema-valid", "sink");

    const first = bootstrapAssetSurfaceRegistry([officialSink, candidateSource, schemaValidSink]);
    assert(first.trustedAssetIds.length === 1 && first.trustedAssetIds[0] === officialSink.id, "only official asset should be trusted");
    assert(first.skippedAssets.length === 2, "candidate and schema-valid assets should be skipped");

    const identity = identityOf(officialSink);
    const exactSink = first.registry.queryCoverage({ identity, expectedRoles: ["sink"], endpoint: arg0 });
    assert(exactSink.status === "covered-exact-role", `official sink should cover sink role, got ${exactSink.status}`);

    const missingSource = first.registry.queryCoverage({ identity, expectedRoles: ["source"], endpoint: arg0 });
    assert(
        missingSource.status === "covered-surface-but-role-missing",
        `candidate source must not contaminate known-covered, got ${missingSource.status}`,
    );

    const second = bootstrapAssetSurfaceRegistry([officialSink, reviewedSource]);
    const reviewedSourceCoverage = second.registry.queryCoverage({ identity, expectedRoles: ["source"], endpoint: arg0 });
    assert(
        reviewedSourceCoverage.status === "covered-exact-role",
        `reviewed project asset should be trusted coverage, got ${reviewedSourceCoverage.status}`,
    );

    const invalidOfficial: AssetDocumentBase = {
        ...makeAsset("asset.invalid.official", "official", "sink"),
        bindings: [],
    };
    const permissive = bootstrapAssetSurfaceRegistry([invalidOfficial], { failOnInvalid: false });
    assert(permissive.validationErrors.length === 1, "invalid trusted asset should be reported");
    assert(permissive.trustedAssetIds.length === 0, "invalid trusted asset should not be loaded");

    let threw = false;
    try {
        bootstrapAssetSurfaceRegistry([invalidOfficial]);
    } catch {
        threw = true;
    }
    assert(threw, "invalid trusted asset should throw by default");

    console.log("PASS test_asset_registry_bootstrap");
}

main();
