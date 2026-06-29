import {
    type AssetDocumentBase,
    type AssetEndpoint,
    type AssetGuard,
    compareEndpoints,
    compareGuards,
    createAssetIdentityIndex,
    resolveCanonicalAssetIdentity,
} from "../../core/assets/schema";
import { createCanonicalApiRegistry } from "../../core/api/identity";
import {
    canonicalApiDescriptorFromTestDeclaration,
    canonicalApiIdFromTestDeclaration,
    indexedTestParameters,
    type TestCanonicalApiDeclaration,
} from "../helpers/CanonicalApiTestDeclarations";
import { exactOfficialInvokeSurface, exactProjectInvokeSurface } from "../helpers/AssetIdentityTestUtils";
import { extendCanonicalApiRegistryWithAssetDeclarations } from "../../core/assets/registry/AssetDeclaredCanonicalApiRegistry";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

const consoleArg0: AssetEndpoint = { base: { kind: "arg", index: 0 } };
const consoleLogDeclaration: TestCanonicalApiDeclaration = {
    authority: "official",
    domain: "openharmony",
    moduleSpecifier: "@ohos.console",
    logicalDeclarationFile: "api/@ohos.console.d.ts",
    exportPath: [{ kind: "namespace", name: "console" }],
    declarationOwner: { kind: "class", path: ["console"], normalizedName: "console" },
    member: { kind: "method", name: "log", static: true },
    invoke: { kind: "call" },
    signature: {
        parameters: indexedTestParameters(["Object"]),
        returnType: { text: "void" },
    },
};
const consoleLogCanonicalApiId = canonicalApiIdFromTestDeclaration(consoleLogDeclaration);
const httpRequestDeclaration: TestCanonicalApiDeclaration = {
    authority: "official",
    domain: "openharmony",
    moduleSpecifier: "@ohos.net.http",
    logicalDeclarationFile: "api/@ohos.net.http.d.ts",
    exportPath: [{ kind: "named", name: "request" }],
    declarationOwner: { kind: "namespace", path: ["http"], normalizedName: "http" },
    member: { kind: "function", name: "request" },
    invoke: { kind: "call" },
    signature: {
        parameters: indexedTestParameters(["RequestOptions"]),
        returnType: { text: "Promise<HttpResponse>" },
    },
};
const httpRequestCanonicalApiId = canonicalApiIdFromTestDeclaration(httpRequestDeclaration);
const vaultPutDeclaration: TestCanonicalApiDeclaration = {
    authority: "project",
    domain: "local",
    moduleSpecifier: "project/model_project.ets",
    logicalDeclarationFile: "project/model_project.ets",
    exportPath: [{ kind: "named", name: "Vault" }],
    declarationOwner: { kind: "class", path: ["Vault"], normalizedName: "Vault" },
    member: { kind: "method", name: "put", static: false },
    invoke: { kind: "call" },
    signature: {
        parameters: indexedTestParameters(["string", "Object"]),
        returnType: { text: "void" },
    },
};
const vaultPutCanonicalApiId = canonicalApiIdFromTestDeclaration(vaultPutDeclaration);

const canonicalRegistry = createCanonicalApiRegistry([
    canonicalApiDescriptorFromTestDeclaration(consoleLogDeclaration),
    canonicalApiDescriptorFromTestDeclaration(httpRequestDeclaration),
    canonicalApiDescriptorFromTestDeclaration(vaultPutDeclaration),
]);

function createTestAssetIdentityIndex() {
    return createAssetIdentityIndex({
        canonicalApiRegistry: canonicalRegistry,
    });
}

function sinkAsset(endpoint: AssetEndpoint = consoleArg0, completeness: "complete" | "partial" | "unknown" = "complete", guard?: AssetGuard): AssetDocumentBase {
    return {
        id: `asset.console.${endpoint.accessPath?.join(".") || "arg0"}`,
        plane: "rule",
        status: "official",
        surfaces: [
            exactOfficialInvokeSurface({
                surfaceId: "surface.console.log",
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
                bindingId: "binding.console.log.sink",
                surfaceId: "surface.console.log",
                assetId: `asset.console.${endpoint.accessPath?.join(".") || "arg0"}`,
                plane: "rule",
                role: "sink",
                canonicalApiId: consoleLogCanonicalApiId,
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
    const identity = resolveCanonicalAssetIdentity(sinkAsset().surfaces[0]);
    assert(identity.status === "resolved" && identity.canonicalApiId, `console identity should resolve: ${identity.reason}`);
    return identity.canonicalApiId;
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

    const registry = createTestAssetIdentityIndex();
    const consoleAsset = sinkAsset();
    registry.addAsset(consoleAsset);
    const identity = consoleIdentity();
    assert(registry.getAsset(consoleAsset.id)?.id === consoleAsset.id, "assetId index should return the loaded asset");
    assert(
        registry.getSurface("surface.console.log")?.canonicalApiId === consoleLogCanonicalApiId,
        "surfaceId index should return the exact surface object",
    );
    assert(
        registry.getBinding("binding.console.log.sink")?.canonicalApiId === consoleLogCanonicalApiId,
        "bindingId index should return the exact binding object",
    );

    const exact = registry.queryCoverage({
        canonicalApiId: identity,
        expectedRoles: ["sink"],
        endpoint: consoleArg0,
    });
    assert(exact.status === "covered-exact-role", `expected exact sink coverage, got ${exact.status}`);
    assert(exact.matchedBindings.length === 1, "exact coverage should return one matched binding");

    const missingRole = registry.queryCoverage({
        canonicalApiId: identity,
        expectedRoles: ["source"],
        endpoint: consoleArg0,
    });
    assert(
        missingRole.status === "covered-surface-but-role-missing",
        `expected role-missing coverage, got ${missingRole.status}`
    );

    const completeSubsuming = registry.queryCoverage({
        canonicalApiId: identity,
        expectedRoles: ["sink"],
        endpoint: bodyEndpoint,
    });
    assert(
        completeSubsuming.status === "covered-exact-role",
        `complete arg0 binding should cover arg0.body, got ${completeSubsuming.status}`
    );

    const partialRegistry = createTestAssetIdentityIndex();
    partialRegistry.addAsset(sinkAsset(consoleArg0, "partial"));
    const partial = partialRegistry.queryCoverage({
        canonicalApiId: identity,
        expectedRoles: ["sink"],
        endpoint: bodyEndpoint,
    });
    assert(partial.status === "covered-partial", `partial arg0 binding should not fully cover arg0.body, got ${partial.status}`);

    const fieldRegistry = createTestAssetIdentityIndex();
    fieldRegistry.addAsset(sinkAsset(bodyEndpoint));
    const disjoint = fieldRegistry.queryCoverage({
        canonicalApiId: identity,
        expectedRoles: ["sink"],
        endpoint: headerEndpoint,
    });
    assert(disjoint.status === "not-covered", `disjoint endpoint should not be covered, got ${disjoint.status}`);

    const guardedRegistry = createTestAssetIdentityIndex();
    guardedRegistry.addAsset(sinkAsset(consoleArg0, "complete", safeGuard));
    const guardDisjoint = guardedRegistry.queryCoverage({
        canonicalApiId: identity,
        expectedRoles: ["sink"],
        endpoint: consoleArg0,
        guard: rawGuard,
    });
    assert(guardDisjoint.status === "not-covered", `disjoint guard should not be covered, got ${guardDisjoint.status}`);

    const freeFunctionAsset: AssetDocumentBase = {
        ...sinkAsset(),
        id: "asset.http.request",
        surfaces: [
            exactOfficialInvokeSurface({
                surfaceId: "surface.http.request",
                moduleSpecifier: "@ohos.net.http",
                logicalDeclarationFile: "api/@ohos.net.http.d.ts",
                exportName: "request",
                ownerName: "http",
                methodName: "request",
                invokeKind: "free-function",
                parameterTypes: ["RequestOptions"],
                returnType: "Promise<HttpResponse>",
            }),
        ],
        bindings: [
            {
                ...sinkAsset().bindings[0],
                bindingId: "binding.http.request.sink",
                surfaceId: "surface.http.request",
                assetId: "asset.http.request",
                canonicalApiId: httpRequestCanonicalApiId,
            },
        ],
        provenance: { source: "builtin" },
    };
    const httpRegistry = createTestAssetIdentityIndex();
    httpRegistry.addAsset(freeFunctionAsset);
    const freeIdentity = resolveCanonicalAssetIdentity(freeFunctionAsset.surfaces[0]);
    assert(freeIdentity.status === "resolved" && freeIdentity.canonicalApiId, `free-function should resolve: ${freeIdentity.reason}`);
    assert(freeIdentity.canonicalApiId.includes("member=function%3Arequest"), "free-function identity key should encode declaration member");

    const declaredProjectSurface = exactProjectInvokeSurface({
        surfaceId: "surface.project.vault.put.declared",
        modulePath: "project/model_project.ets",
        ownerName: "Vault",
        methodName: "put",
        invokeKind: "instance",
        parameterTypes: ["string", "Object"],
        returnType: "void",
        provenance: {
            source: "manual",
            location: { file: "project/model_project.ets" },
        },
    });
    const declaredProjectAsset: AssetDocumentBase = {
        ...sinkAsset(),
        id: "asset.project.vault.put.declared",
        surfaces: [declaredProjectSurface],
        bindings: [
            {
                ...sinkAsset().bindings[0],
                bindingId: "binding.project.vault.put.declared",
                surfaceId: declaredProjectSurface.surfaceId,
                assetId: "asset.project.vault.put.declared",
                canonicalApiId: declaredProjectSurface.canonicalApiId,
                endpoint: { base: { kind: "arg", index: 1 } },
            },
        ],
        provenance: {
            source: "project",
            evidenceLocations: [{ file: "project/model_project.ets" }],
        },
    };
    const consoleOnlyBaseRegistry = createCanonicalApiRegistry([
        canonicalApiDescriptorFromTestDeclaration(consoleLogDeclaration),
    ]);
    const projectDeclaredRegistry = extendCanonicalApiRegistryWithAssetDeclarations({
        baseRegistry: consoleOnlyBaseRegistry,
        assets: [declaredProjectAsset],
    });
    assert(
        projectDeclaredRegistry.has(declaredProjectSurface.canonicalApiId!),
        "project canonicalApiId declared by an exact asset should extend the registry",
    );
    const projectDeclaredIndex = createAssetIdentityIndex({
        canonicalApiRegistry: projectDeclaredRegistry,
    });
    projectDeclaredIndex.addAsset(declaredProjectAsset);
    assert(
        projectDeclaredIndex.findBindings(declaredProjectSurface.canonicalApiId!).length === 1,
        "project-declared canonicalApiId should be indexable after registry extension",
    );
    const officialSelfDeclaredRegistry = extendCanonicalApiRegistryWithAssetDeclarations({
        baseRegistry: consoleOnlyBaseRegistry,
        assets: [freeFunctionAsset],
    });
    assert(
        !officialSelfDeclaredRegistry.has(httpRequestCanonicalApiId),
        "official canonicalApiId must not be registered from the asset itself",
    );

    const consoleOnlyRegistry = createAssetIdentityIndex({
        canonicalApiRegistry: officialSelfDeclaredRegistry,
    });
    let unregisteredThrew = false;
    try {
        consoleOnlyRegistry.addAsset(freeFunctionAsset);
    } catch (error) {
        unregisteredThrew = String(error).includes("canonicalApiId is not registered");
    }
    assert(unregisteredThrew, "unregistered canonicalApiId must fail before indexing");
    assert(!consoleOnlyRegistry.getAsset(freeFunctionAsset.id), "unregistered asset must not be partially indexed");
    assert(consoleOnlyRegistry.findBindings(httpRequestCanonicalApiId).length === 0, "unregistered binding must not be indexed");
    const unregisteredCoverage = consoleOnlyRegistry.queryCoverage({
        canonicalApiId: httpRequestCanonicalApiId,
        expectedRoles: ["sink"],
        endpoint: consoleArg0,
    });
    assert(
        unregisteredCoverage.status === "identity-unresolved",
        `unregistered coverage query should be identity-unresolved, got ${unregisteredCoverage.status}`,
    );
    const invalidCoverage = registry.queryCoverage({
        canonicalApiId: "not-a-canonical-id",
        expectedRoles: ["sink"],
        endpoint: consoleArg0,
    });
    assert(invalidCoverage.status === "identity-unresolved", "invalid canonicalApiId query should be identity-unresolved");

    let apiIdentityObjectIdThrew = false;
    try {
        createTestAssetIdentityIndex().addAsset({
            ...sinkAsset(),
            id: "asset.bad.surface.identity",
            surfaces: [{ ...sinkAsset().surfaces[0], surfaceId: consoleLogCanonicalApiId }],
            bindings: [{
                ...sinkAsset().bindings[0],
                bindingId: consoleLogCanonicalApiId,
                surfaceId: consoleLogCanonicalApiId,
                assetId: "asset.bad.surface.identity",
            }],
        });
    } catch (error) {
        apiIdentityObjectIdThrew = String(error).includes("must be an object id");
    }
    assert(apiIdentityObjectIdThrew, "surfaceId and bindingId must not be the canonical API identity");

    let duplicateBindingThrew = false;
    try {
        const duplicateBindingAsset = sinkAsset();
        createTestAssetIdentityIndex().addAsset({
            ...duplicateBindingAsset,
            id: "asset.bad.duplicate.binding",
            bindings: [
                { ...duplicateBindingAsset.bindings[0], assetId: "asset.bad.duplicate.binding" },
                { ...duplicateBindingAsset.bindings[0], assetId: "asset.bad.duplicate.binding" },
            ],
        });
    } catch (error) {
        duplicateBindingThrew = String(error).includes("duplicate bindingId");
    }
    assert(duplicateBindingThrew, "duplicate bindingId must fail during identity indexing");

    const projectPathLeft = resolveCanonicalAssetIdentity({
        ...exactProjectInvokeSurface({
            surfaceId: "surface.project.path.left",
            modulePath: "project/model_project.ets",
            ownerName: "Vault",
            methodName: "put",
            invokeKind: "instance",
            parameterTypes: ["string", "Object"],
            returnType: "void",
            provenanceSource: "analyzer",
        }),
        canonicalApiId: vaultPutCanonicalApiId,
    });
    const projectPathRight = resolveCanonicalAssetIdentity({
        ...exactProjectInvokeSurface({
            surfaceId: "surface.project.path.right",
            modulePath: "model_project.ets",
            ownerName: "Vault",
            methodName: "put",
            invokeKind: "instance",
            parameterTypes: ["string", "Object"],
            returnType: "void",
            provenanceSource: "analyzer",
        }),
        canonicalApiId: vaultPutCanonicalApiId,
    });
    assert(projectPathLeft.status === "resolved" && projectPathLeft.canonicalApiId, `project-prefixed identity should resolve: ${projectPathLeft.reason}`);
    assert(projectPathRight.status === "resolved" && projectPathRight.canonicalApiId, `project-local identity should resolve: ${projectPathRight.reason}`);
    assert(
        projectPathLeft.canonicalApiId === projectPathRight.canonicalApiId,
        "explicit project declaration identity should be independent of runtime surface path spelling",
    );

    const unresolved = resolveCanonicalAssetIdentity({
        ...freeFunctionAsset.surfaces[0],
        canonicalApiId: undefined,
    } as any);
    assert(unresolved.status === "unresolved", "unknown module surface should not resolve");

    console.log("PASS test_asset_identity_index");
}

main();
