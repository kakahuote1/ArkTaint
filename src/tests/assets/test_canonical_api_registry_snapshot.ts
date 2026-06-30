import * as fs from "fs";
import * as path from "path";
import {
    buildMixedDeclarationRegistry,
    buildOfficialDeclarationRegistry,
    buildProjectDeclarationRegistry,
    buildThirdPartyDeclarationRegistry,
    loadCanonicalApiRegistryFromSnapshot,
    loadCanonicalApiRegistrySnapshot,
    toCanonicalApiRegistrySnapshot,
    validateCanonicalApiRegistrySnapshot,
    writeCanonicalApiRegistrySnapshot,
    type CanonicalApiDeclarationEvidence,
    type CanonicalApiRegistrySnapshot,
} from "../../core/api/identity";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function projectDeclaration(overrides: Partial<CanonicalApiDeclarationEvidence> = {}): CanonicalApiDeclarationEvidence {
    return {
        domain: "local",
        moduleSpecifier: "src/main/ets/security/Vault.ets",
        logicalDeclarationFile: "src/main/ets/security/Vault.ets",
        exportPath: [{ kind: "named", name: "Vault" }],
        declarationOwner: {
            kind: "class",
            path: ["Vault"],
            normalizedName: "Vault",
        },
        member: {
            kind: "method",
            name: "put",
            static: false,
        },
        invoke: { kind: "call" },
        signature: {
            parameters: [
                { index: 0, type: { text: "string" } },
                { index: 1, type: { text: "SecretValue" } },
            ],
            returnType: { text: "Promise<void>" },
        },
        declarationLocations: [{ file: "src/main/ets/security/Vault.ets", line: 7 }],
        ...overrides,
    };
}

function officialDeclaration(): CanonicalApiDeclarationEvidence {
    return {
        domain: "openharmony",
        moduleSpecifier: "@ohos.net.http",
        logicalDeclarationFile: "api/@ohos.net.http.d.ts",
        exportPath: [{ kind: "named", name: "request" }],
        declarationOwner: {
            kind: "file",
            path: ["file"],
            normalizedName: "file",
        },
        member: {
            kind: "function",
            name: "request",
        },
        invoke: { kind: "call" },
        signature: {
            parameters: [{ index: 0, type: { text: "http.HttpRequestOptions" } }],
            returnType: { text: "Promise<http.HttpResponse>" },
        },
        declarationLocations: [{ file: "api/@ohos.net.http.d.ts", line: 1 }],
    };
}

function thirdPartyDeclaration(): CanonicalApiDeclarationEvidence {
    return {
        domain: "npm",
        moduleSpecifier: "npm/@vendor/sdk",
        logicalDeclarationFile: "node_modules/@vendor/sdk/index.d.ts",
        exportPath: [{ kind: "named", name: "Client" }],
        declarationOwner: {
            kind: "class",
            path: ["Client"],
            normalizedName: "Client",
        },
        member: {
            kind: "method",
            name: "send",
            static: false,
        },
        invoke: { kind: "call" },
        signature: {
            parameters: [{ index: 0, type: { text: "MessagePayload" } }],
            returnType: { text: "Promise<SendResult>" },
        },
        declarationLocations: [{ file: "node_modules/@vendor/sdk/index.d.ts", line: 12 }],
    };
}

function main(): void {
    const official = buildOfficialDeclarationRegistry([officialDeclaration()]);
    assert(official.ok, `official registry should build: ${official.diagnostics.map(item => item.message).join("; ")}`);

    const project = buildProjectDeclarationRegistry([projectDeclaration()]);
    assert(project.ok, `project registry should build: ${project.diagnostics.map(item => item.message).join("; ")}`);

    const thirdParty = buildThirdPartyDeclarationRegistry([thirdPartyDeclaration()]);
    assert(thirdParty.ok, `third-party registry should build: ${thirdParty.diagnostics.map(item => item.message).join("; ")}`);

    const mixed = buildMixedDeclarationRegistry({
        official: [officialDeclaration()],
        project: [projectDeclaration()],
        thirdParty: [thirdPartyDeclaration()],
    });
    assert(mixed.ok, `mixed registry should build: ${mixed.diagnostics.map(item => item.message).join("; ")}`);
    assert(mixed.descriptors.length === 3, `mixed registry should contain three descriptors, got ${mixed.descriptors.length}`);

    const snapshot = toCanonicalApiRegistrySnapshot(mixed);
    assert(!("version" in snapshot) && !("schemaVersion" in snapshot) && !("v" in snapshot), "snapshot must not contain a version field");

    const outDir = path.resolve("tmp/test_runs/assets/canonical_api_registry_snapshot");
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    const snapshotPath = path.join(outDir, "canonical_api_registry.mixed.json");
    writeCanonicalApiRegistrySnapshot(snapshotPath, snapshot);

    const loaded = loadCanonicalApiRegistrySnapshot(snapshotPath);
    assert(loaded.descriptors.length === 3, "loaded snapshot must preserve descriptors");

    const registry = loadCanonicalApiRegistryFromSnapshot(snapshotPath);
    const projectDescriptor = project.descriptors[0];
    const resolved = registry.resolveProjectDeclarationKey({
        file: "D:/repo/src/main/ets/security/Vault.ets",
        exportPath: ["named:Vault"],
        ownerPath: ["Vault"],
        memberName: "put",
        parameterTypes: ["string", "SecretValue"],
        returnType: "Promise<void>",
    });
    assert(resolved.status === "accepted", `project declaration should resolve from loaded registry, got ${resolved.status}:${resolved.reason}`);
    assert(resolved.canonicalApiId === projectDescriptor.canonicalApiId, "loaded registry must resolve the project descriptor ID");

    const arkanalyzerShortPathResolved = registry.resolveProjectDeclarationKey({
        file: "@ets/security/Vault.ets",
        exportPath: ["named:Vault"],
        ownerPath: ["Vault"],
        memberName: "put",
        parameterTypes: ["string", "SecretValue"],
        returnType: "Promise<void>",
    });
    assert(
        arkanalyzerShortPathResolved.status === "accepted",
        `project declaration should resolve the same source file from Arkanalyzer short path, got ${arkanalyzerShortPathResolved.status}:${arkanalyzerShortPathResolved.reason}`,
    );
    assert(
        arkanalyzerShortPathResolved.canonicalApiId === projectDescriptor.canonicalApiId,
        "src/main/ets and @ets source path forms must resolve to the same project descriptor ID",
    );

    const unknown = buildProjectDeclarationRegistry([
        projectDeclaration({
            signature: {
                parameters: [{ index: 0, type: { text: "%unk" } }],
                returnType: { text: "Promise<void>" },
            },
        }),
    ]);
    assert(!unknown.ok, "unknown parameter registry build must fail");
    assert(unknown.diagnostics.some(item => item.code === "canonical_descriptor_parameter_type_unknown"), "unknown parameter must produce a typed diagnostic");

    const duplicateSnapshot: CanonicalApiRegistrySnapshot = {
        ...snapshot,
        descriptors: [snapshot.descriptors[0], snapshot.descriptors[0]],
    };
    const duplicateValidation = validateCanonicalApiRegistrySnapshot(duplicateSnapshot);
    assert(!duplicateValidation.ok, "duplicate descriptor snapshot must be invalid");
    assert(duplicateValidation.diagnostics.some(item => item.code === "descriptor_duplicate"), "duplicate descriptor must produce descriptor_duplicate");

    const mismatchedSnapshot: CanonicalApiRegistrySnapshot = {
        ...snapshot,
        descriptors: [{
            ...snapshot.descriptors[0],
            moduleSpecifier: "api/other.d.ts",
        }],
    };
    const mismatchedValidation = validateCanonicalApiRegistrySnapshot(mismatchedSnapshot);
    assert(!mismatchedValidation.ok, "descriptor field/id mismatch must be invalid");
    assert(mismatchedValidation.diagnostics.some(item => item.code === "descriptor_canonical_id_mismatch"), "mismatch must produce descriptor_canonical_id_mismatch");

    const forbiddenVersionValidation = validateCanonicalApiRegistrySnapshot({
        ...snapshot,
        schemaVersion: "v1",
    });
    assert(!forbiddenVersionValidation.ok, "snapshot version fields must be forbidden");

    console.log("canonical_api_registry_snapshot_ok");
}

main();
