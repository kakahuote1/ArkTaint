import {
    createCanonicalApiRegistry,
    fromArkanalyzerMethodKey,
    fromImportMemberKey,
    fromProjectDeclaration,
    parseCanonicalApiId,
    type CanonicalApiDeclarationEvidence,
} from "../../core/api/identity";
import type { ImportMemberKey } from "../../core/api/identity/ImportMemberKey";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function mustBuild(evidence: CanonicalApiDeclarationEvidence): ReturnType<typeof fromProjectDeclaration> & { status: "accepted" } {
    const result = fromProjectDeclaration(evidence);
    assert(result.status === "accepted", `descriptor should build, got ${result.status}:${result.status === "rejected" ? result.reason : ""}`);
    return result;
}

function projectEvidence(overrides: Partial<CanonicalApiDeclarationEvidence> = {}): CanonicalApiDeclarationEvidence {
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

function importKey(): ImportMemberKey {
    return {
        moduleSpecifier: "src/main/ets/security/Vault.ets",
        importKind: "named",
        importedName: "Vault",
        localBindingId: "entry:Vault",
        localName: "Vault",
        aliasChain: [],
        memberChain: ["put"],
        invokeKind: "call",
        argShape: {
            arity: 2,
            parameterTypes: ["string", "SecretValue"],
            returnType: "Promise<void>",
        },
        scopeEvidence: {
            sourceFile: "src/main/ets/pages/Index.ets",
            enclosingMethodSignature: "@entry/src/main/ets/pages/Index.ets: Index.build()",
            shadowed: false,
        },
    };
}

function main(): void {
    const base = mustBuild(projectEvidence());
    const sameAgain = mustBuild(projectEvidence());
    assert(base.descriptor.canonicalApiId === sameAgain.descriptor.canonicalApiId, "same declaration evidence must produce the same canonicalApiId");

    const sameNameOtherModule = mustBuild(projectEvidence({
        moduleSpecifier: "src/main/ets/other/Vault.ets",
        logicalDeclarationFile: "src/main/ets/other/Vault.ets",
        declarationLocations: [{ file: "src/main/ets/other/Vault.ets" }],
    }));
    assert(base.descriptor.canonicalApiId !== sameNameOtherModule.descriptor.canonicalApiId, "same API name in a different module must produce a different ID");

    const sameNameOtherParams = mustBuild(projectEvidence({
        signature: {
            parameters: [{ index: 0, type: { text: "SecretValue" } }],
            returnType: { text: "Promise<void>" },
        },
    }));
    assert(base.descriptor.canonicalApiId !== sameNameOtherParams.descriptor.canonicalApiId, "same owner/name with different params must produce a different ID");

    const sameNameOtherReturn = mustBuild(projectEvidence({
        signature: {
            parameters: [
                { index: 0, type: { text: "string" } },
                { index: 1, type: { text: "SecretValue" } },
            ],
            returnType: { text: "boolean" },
        },
    }));
    assert(base.descriptor.canonicalApiId !== sameNameOtherReturn.descriptor.canonicalApiId, "same owner/name/params with different return must produce a different ID");

    const genericCommaParam = mustBuild(projectEvidence({
        member: { kind: "method", name: "onWillChange", static: false },
        signature: {
            parameters: [{ index: 0, name: "callback", type: { text: "Callback<RichEditorChangeValue, boolean>" } }],
            returnType: { text: "RichEditorAttribute" },
        },
    }));
    assert(
        parseCanonicalApiId(genericCommaParam.descriptor.canonicalApiId)?.params === "0:Callback<RichEditorChangeValue, boolean>",
        "canonical ID parser must preserve generic parameter commas inside a single indexed parameter",
    );

    const constructor = mustBuild(projectEvidence({
        member: { kind: "constructor", name: "constructor" },
        invoke: { kind: "new" },
        signature: {
            parameters: [{ index: 0, type: { text: "SecretConfig" } }],
            returnType: { text: "Vault" },
        },
    }));
    const constructorParts = parseCanonicalApiId(constructor.descriptor.canonicalApiId);
    assert(constructorParts?.member === "constructor:new:constructor", "constructor ID must encode member as constructor, not class name");

    const unknownParam = fromProjectDeclaration(projectEvidence({
        signature: {
            parameters: [{ index: 0, type: { text: "unknown" } }],
            returnType: { text: "Promise<void>" },
        },
    }));
    assert(unknownParam.status === "rejected", "unknown parameter type must reject descriptor build");

    const unknownReturn = fromProjectDeclaration(projectEvidence({
        signature: {
            parameters: [],
            returnType: { text: "unknown" },
        },
    }));
    assert(unknownReturn.status === "rejected", "unknown return type must reject descriptor build");

    const absoluteFile = fromProjectDeclaration(projectEvidence({
        logicalDeclarationFile: "D:/cursor/workplace/ArkTaint/src/main/ets/security/Vault.ets",
    }));
    assert(absoluteFile.status === "rejected", "absolute local paths must not enter canonicalApiId");

    assert(parseCanonicalApiId(base.descriptor.canonicalApiId)?.ret === "Promise<void>", "declaration builder must preserve exact return type");

    const arkanalyzerUnknown = fromArkanalyzerMethodKey({
        declaringFileName: "@%unk/%unk",
        declaringNamespacePath: [],
        declaringClassName: "%unk",
        methodName: "put",
        parameterTypes: ["string"],
        returnType: "void",
        staticFlag: false,
    }, {
        authority: "project",
        domain: "local",
        exportPath: [{ kind: "named", name: "Vault" }],
    });
    assert(arkanalyzerUnknown.status === "rejected", "Arkanalyzer unknown method key must reject descriptor build");

    const registry = createCanonicalApiRegistry([base.descriptor]);
    const imported = fromImportMemberKey(importKey(), registry);
    assert(imported.status === "accepted", `import key should resolve by registry exact key, got ${imported.status}`);
    assert(imported.status === "accepted" && imported.descriptor.canonicalApiId === base.descriptor.canonicalApiId, "import builder must return registered descriptor");

    console.log("canonical_api_descriptor_builder_ok");
}

main();
