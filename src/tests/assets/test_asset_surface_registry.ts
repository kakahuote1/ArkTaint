import {
    type AssetDocumentBase,
    type AssetEndpoint,
    type AssetGuard,
    assetIdentityKey,
    compareEndpoints,
    compareGuards,
    createAssetSurfaceRegistry,
    resolveAssetIdentity,
} from "../../core/assets/schema";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

const consoleArg0: AssetEndpoint = { base: { kind: "arg", index: 0 } };

function sinkAsset(endpoint: AssetEndpoint = consoleArg0, completeness: "complete" | "partial" | "unknown" = "complete", guard?: AssetGuard): AssetDocumentBase {
    return {
        id: `asset.console.${endpoint.accessPath?.join(".") || "arg0"}`,
        plane: "rule",
        status: "official",
        surfaces: [
            {
                surfaceId: "surface.console.log",
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
                bindingId: "binding.console.log.sink",
                surfaceId: "surface.console.log",
                assetId: `asset.console.${endpoint.accessPath?.join(".") || "arg0"}`,
                plane: "rule",
                role: "sink",
                endpoint,
                guard,
                effectTemplateRefs: ["template.console.log.sink"],
                semanticsFamily: "privacy-log",
                completeness,
                confidence: "certain",
            },
        ],
        effectTemplates: [
            {
                id: "template.console.log.sink",
                kind: "rule.sink",
                value: endpoint,
                sinkKind: "log",
                confidence: "certain",
            },
        ],
        provenance: { source: "builtin" },
    };
}

function consoleIdentity() {
    const identity = resolveAssetIdentity(sinkAsset().surfaces[0]);
    assert(identity.status === "resolved" && identity.identity, `console identity should resolve: ${identity.reason}`);
    return identity.identity;
}

function main(): void {
    const exactEndpoint: AssetEndpoint = { base: { kind: "arg", index: 0 } };
    const bodyEndpoint: AssetEndpoint = { base: { kind: "arg", index: 0 }, accessPath: ["body"] };
    const headerEndpoint: AssetEndpoint = { base: { kind: "arg", index: 0 }, accessPath: ["headers", "Authorization"] };
    assert(compareEndpoints(exactEndpoint, exactEndpoint) === "exact", "same endpoint should be exact");
    assert(compareEndpoints(exactEndpoint, bodyEndpoint) === "subsumes", "arg0 should subsume arg0.body");
    assert(compareEndpoints(bodyEndpoint, exactEndpoint) === "subsumed-by", "arg0.body should be subsumed by arg0");
    assert(compareEndpoints(bodyEndpoint, headerEndpoint) === "disjoint", "different arg0 fields should be disjoint");

    const modeEndpoint: AssetEndpoint = { base: { kind: "arg", index: 0 }, accessPath: ["mode"] };
    const safeGuard: AssetGuard = { conditions: [{ kind: "const-eq", endpoint: modeEndpoint, value: "safe" }] };
    const rawGuard: AssetGuard = { conditions: [{ kind: "const-eq", endpoint: modeEndpoint, value: "raw" }] };
    assert(compareGuards(safeGuard, safeGuard) === "equivalent", "same guard should be equivalent");
    assert(compareGuards(safeGuard, rawGuard) === "disjoint", "different const-eq guards on same endpoint should be disjoint");

    const registry = createAssetSurfaceRegistry();
    registry.addAsset(sinkAsset());
    const identity = consoleIdentity();

    const exact = registry.queryCoverage({
        identity,
        expectedRoles: ["sink"],
        endpoint: consoleArg0,
    });
    assert(exact.status === "covered-exact-role", `expected exact sink coverage, got ${exact.status}`);
    assert(exact.matchedBindings.length === 1, "exact coverage should return one matched binding");

    const missingRole = registry.queryCoverage({
        identity,
        expectedRoles: ["source"],
        endpoint: consoleArg0,
    });
    assert(
        missingRole.status === "covered-surface-but-role-missing",
        `expected role-missing coverage, got ${missingRole.status}`
    );

    const completeSubsuming = registry.queryCoverage({
        identity,
        expectedRoles: ["sink"],
        endpoint: bodyEndpoint,
    });
    assert(
        completeSubsuming.status === "covered-exact-role",
        `complete arg0 binding should cover arg0.body, got ${completeSubsuming.status}`
    );

    const partialRegistry = createAssetSurfaceRegistry();
    partialRegistry.addAsset(sinkAsset(consoleArg0, "partial"));
    const partial = partialRegistry.queryCoverage({
        identity,
        expectedRoles: ["sink"],
        endpoint: bodyEndpoint,
    });
    assert(partial.status === "covered-partial", `partial arg0 binding should not fully cover arg0.body, got ${partial.status}`);

    const fieldRegistry = createAssetSurfaceRegistry();
    fieldRegistry.addAsset(sinkAsset(bodyEndpoint));
    const disjoint = fieldRegistry.queryCoverage({
        identity,
        expectedRoles: ["sink"],
        endpoint: headerEndpoint,
    });
    assert(disjoint.status === "not-covered", `disjoint endpoint should not be covered, got ${disjoint.status}`);

    const guardedRegistry = createAssetSurfaceRegistry();
    guardedRegistry.addAsset(sinkAsset(consoleArg0, "complete", safeGuard));
    const guardDisjoint = guardedRegistry.queryCoverage({
        identity,
        expectedRoles: ["sink"],
        endpoint: consoleArg0,
        guard: rawGuard,
    });
    assert(guardDisjoint.status === "not-covered", `disjoint guard should not be covered, got ${guardDisjoint.status}`);

    const freeFunctionAsset: AssetDocumentBase = {
        ...sinkAsset(),
        id: "asset.http.request",
        surfaces: [
            {
                surfaceId: "surface.http.request",
                kind: "invoke",
                modulePath: "@ohos.net.http",
                functionName: "request",
                invokeKind: "free-function",
                argCount: 1,
                confidence: "certain",
                provenance: { source: "sdk" },
            },
        ],
        bindings: [
            {
                ...sinkAsset().bindings[0],
                bindingId: "binding.http.request.sink",
                surfaceId: "surface.http.request",
                assetId: "asset.http.request",
            },
        ],
        provenance: { source: "builtin" },
    };
    const freeIdentity = resolveAssetIdentity(freeFunctionAsset.surfaces[0]);
    assert(freeIdentity.status === "resolved" && freeIdentity.identity, `free-function should resolve: ${freeIdentity.reason}`);
    assert(assetIdentityKey(freeIdentity.identity).includes("free-function"), "free-function identity key should encode invoke kind");

    const projectPathLeft = resolveAssetIdentity({
        surfaceId: "surface.project.path.left",
        kind: "invoke",
        modulePath: "project/model_project.ets",
        ownerName: "Vault",
        methodName: "put",
        invokeKind: "instance",
        argCount: 2,
        confidence: "certain",
        provenance: { source: "analyzer" },
    });
    const projectPathRight = resolveAssetIdentity({
        surfaceId: "surface.project.path.right",
        kind: "invoke",
        modulePath: "model_project.ets",
        ownerName: "Vault",
        methodName: "put",
        invokeKind: "instance",
        argCount: 2,
        confidence: "certain",
        provenance: { source: "analyzer" },
    });
    assert(projectPathLeft.status === "resolved" && projectPathLeft.identity, `project-prefixed identity should resolve: ${projectPathLeft.reason}`);
    assert(projectPathRight.status === "resolved" && projectPathRight.identity, `project-local identity should resolve: ${projectPathRight.reason}`);
    assert(
        assetIdentityKey(projectPathLeft.identity) === assetIdentityKey(projectPathRight.identity),
        "identity canonicalization should normalize ArkAnalyzer's synthetic project/ prefix",
    );

    const unresolved = resolveAssetIdentity({
        ...freeFunctionAsset.surfaces[0],
        modulePath: "@unk/http",
    } as any);
    assert(unresolved.status === "unresolved", "unknown module surface should not resolve");

    console.log("PASS test_asset_surface_registry");
}

main();
