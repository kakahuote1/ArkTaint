import {
    bootstrapAssetIdentityIndex,
    type AssetDocumentBase,
    type AssetEndpoint,
    resolveCanonicalAssetIdentity,
} from "../../core/assets/schema";
import { createCanonicalApiRegistry } from "../../core/api/identity";
import {
    canonicalApiDescriptorFromTestDeclaration,
    canonicalApiIdFromTestDeclaration,
    indexedTestParameters,
    type TestCanonicalApiDeclaration,
} from "../helpers/CanonicalApiTestDeclarations";
import { exactOfficialInvokeSurface } from "../helpers/AssetIdentityTestUtils";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

const arg0: AssetEndpoint = { base: { kind: "arg", index: 0 } };
const consoleLogDeclaration: TestCanonicalApiDeclaration = {
    authority: "official",
    domain: "openharmony",
    moduleSpecifier: "@ohos.console",
    logicalDeclarationFile: "api/@ohos.console.d.ts",
    exportPath: [{ kind: "namespace", name: "console" }],
    declarationOwner: { kind: "class", path: ["console"], normalizedName: "console", arkanalyzerName: "console" },
    member: { kind: "method", name: "log", static: true },
    invoke: { kind: "call" },
    signature: {
        parameters: indexedTestParameters(["Object"]),
        returnType: { text: "void" },
    },
};
const consoleLogCanonicalApiId = canonicalApiIdFromTestDeclaration(consoleLogDeclaration);
const canonicalRegistry = createCanonicalApiRegistry([
    canonicalApiDescriptorFromTestDeclaration(consoleLogDeclaration),
]);

function bootstrapStrict(assets: readonly AssetDocumentBase[], options: { failOnInvalid?: boolean } = {}) {
    return bootstrapAssetIdentityIndex(assets, {
        ...options,
        canonicalApiRegistry: canonicalRegistry,
    });
}

function makeAsset(id: string, status: AssetDocumentBase["status"], role: "sink" | "source" = "sink"): AssetDocumentBase {
    const effectId = `template.${id}.${role}`;
    return {
        id,
        plane: "rule",
        status,
        surfaces: [
            exactOfficialInvokeSurface({
                surfaceId: `surface.${id}`,
                moduleSpecifier: "@ohos.console",
                logicalDeclarationFile: "api/@ohos.console.d.ts",
                exportName: "console",
                ownerName: "console",
                methodName: "log",
                invokeKind: "static",
                parameterTypes: ["Object"],
                returnType: "void",
            }),
        ],
        bindings: [
            {
                bindingId: `binding.${id}.${role}`,
                surfaceId: `surface.${id}`,
                assetId: id,
                plane: "rule",
                role,
                canonicalApiId: consoleLogCanonicalApiId,
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
    const result = resolveCanonicalAssetIdentity(asset.surfaces[0]);
    assert(result.status === "resolved" && result.canonicalApiId, `identity should resolve: ${result.reason}`);
    return result.canonicalApiId;
}

function main(): void {
    const officialSink = makeAsset("asset.official.console.sink", "official", "sink");
    const candidateSource = makeAsset("asset.candidate.console.source", "candidate", "source");
    const reviewedSource = makeAsset("asset.reviewed.console.source", "reviewed", "source");
    const schemaValidSink = makeAsset("asset.schema-valid.console.sink", "schema-valid", "sink");

    const first = bootstrapStrict([officialSink, candidateSource, schemaValidSink]);
    assert(first.trustedAssetIds.length === 1 && first.trustedAssetIds[0] === officialSink.id, "only official asset should be trusted");
    assert(first.skippedAssets.length === 2, "candidate and schema-valid assets should be skipped");

    const identity = identityOf(officialSink);
    const exactSink = first.registry.queryCoverage({ canonicalApiId: identity, expectedRoles: ["sink"], endpoint: arg0 });
    assert(exactSink.status === "covered-exact-role", `official sink should cover sink role, got ${exactSink.status}`);

    const missingSource = first.registry.queryCoverage({ canonicalApiId: identity, expectedRoles: ["source"], endpoint: arg0 });
    assert(
        missingSource.status === "covered-surface-but-role-missing",
        `candidate source must not contaminate known-covered, got ${missingSource.status}`,
    );

    const second = bootstrapStrict([officialSink, reviewedSource]);
    const reviewedSourceCoverage = second.registry.queryCoverage({ canonicalApiId: identity, expectedRoles: ["source"], endpoint: arg0 });
    assert(
        reviewedSourceCoverage.status === "covered-exact-role",
        `reviewed project asset should be trusted coverage, got ${reviewedSourceCoverage.status}`,
    );

    const invalidOfficial: AssetDocumentBase = {
        ...makeAsset("asset.invalid.official", "official", "sink"),
        bindings: [],
    };
    const permissive = bootstrapStrict([invalidOfficial], { failOnInvalid: false });
    assert(permissive.validationErrors.length === 1, "invalid trusted asset should be reported");
    assert(permissive.trustedAssetIds.length === 0, "invalid trusted asset should not be loaded");

    let threw = false;
    try {
        bootstrapStrict([invalidOfficial]);
    } catch {
        threw = true;
    }
    assert(threw, "invalid trusted asset should throw by default");

    const emptyCanonicalRegistry = createCanonicalApiRegistry([]);
    const unregistered = bootstrapAssetIdentityIndex([officialSink], {
        failOnInvalid: false,
        canonicalApiRegistry: emptyCanonicalRegistry,
    });
    assert(unregistered.validationErrors.length === 1, "unregistered trusted canonicalApiId should be reported");
    assert(unregistered.trustedAssetIds.length === 0, "unregistered trusted asset should not be loaded");
    assert(!unregistered.registry.getAsset(officialSink.id), "unregistered trusted asset must not be partially indexed");
    const unregisteredCoverage = unregistered.registry.queryCoverage({
        canonicalApiId: identity,
        expectedRoles: ["sink"],
        endpoint: arg0,
    });
    assert(
        unregisteredCoverage.status === "identity-unresolved",
        `unregistered query should be identity-unresolved, got ${unregisteredCoverage.status}`,
    );

    console.log("PASS test_asset_registry_bootstrap");
}

main();
