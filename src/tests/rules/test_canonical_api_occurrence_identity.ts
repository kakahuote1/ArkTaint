import {
    createAssetIdentityIndex,
    type AssetDocumentBase,
    type AssetEndpoint,
} from "../../core/assets/schema";
import { buildCanonicalApiId } from "../../core/api/identity/CanonicalApiId";
import { createCanonicalApiRegistry, type CanonicalApiDescriptor } from "../../core/api/identity";
import { ApiOccurrenceResolver } from "../../core/api/occurrence";
import { projectBindingToEffect } from "../../core/api/effects";
import {
    importMemberCandidateKeyFromImportMemberKey,
    importMemberCandidateKeyString,
    importMemberKeyString,
    knownShapeConstraintsFromImportMemberKey,
    type ImportMemberKey,
} from "../../core/api/identity/ImportMemberKey";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

const requestEndpoint: AssetEndpoint = { base: { kind: "arg", index: 0 } };

const httpRequestDescriptorInput = {
    authority: "official" as const,
    domain: "openharmony" as const,
    moduleSpecifier: "@ohos.net.http",
    logicalDeclarationFile: "api/@ohos.net.http.d.ts",
    exportPath: [{ kind: "named" as const, name: "request" }],
    declarationOwner: {
        kind: "file" as const,
        path: ["file"],
        normalizedName: "file",
    },
    member: {
        kind: "function" as const,
        name: "request",
    },
    invoke: {
        kind: "call" as const,
    },
    signature: {
        parameters: [{ index: 0, type: { text: "http.HttpRequestOptions" } }],
        returnType: { text: "Promise<http.HttpResponse>" },
    },
    provenance: {
        source: "official-declaration" as const,
        declarationLocations: [{ file: "api/@ohos.net.http.d.ts" }],
    },
};

const httpRequestCanonicalApiId = buildCanonicalApiId(httpRequestDescriptorInput);

const httpRequestDescriptor: CanonicalApiDescriptor = {
    canonicalApiId: httpRequestCanonicalApiId,
    ...httpRequestDescriptorInput,
};

const routerPushUrlDescriptorInput = {
    authority: "official" as const,
    domain: "openharmony" as const,
    moduleSpecifier: "@ohos.router",
    logicalDeclarationFile: "api/@ohos.router.d.ts",
    exportPath: [{ kind: "default" as const, name: "pushUrl" }],
    declarationOwner: {
        kind: "namespace" as const,
        path: ["pushUrl"],
        normalizedName: "pushUrl",
    },
    member: {
        kind: "function" as const,
        name: "pushUrl",
    },
    invoke: {
        kind: "call" as const,
    },
    signature: {
        parameters: [{ index: 0, type: { text: "router.RouterOptions" } }],
        returnType: { text: "Promise<void>" },
    },
    provenance: {
        source: "official-declaration" as const,
        declarationLocations: [{ file: "api/@ohos.router.d.ts" }],
    },
};

const routerPushUrlCanonicalApiId = buildCanonicalApiId(routerPushUrlDescriptorInput);

const routerPushUrlDescriptor: CanonicalApiDescriptor = {
    canonicalApiId: routerPushUrlCanonicalApiId,
    ...routerPushUrlDescriptorInput,
};

const utilTextEncoderEncodeIntoDescriptorInput = {
    authority: "official" as const,
    domain: "openharmony" as const,
    moduleSpecifier: "@ohos.util",
    logicalDeclarationFile: "api/@ohos.util.d.ts",
    exportPath: [{ kind: "namespace" as const, name: "util.TextEncoder" }],
    declarationOwner: {
        kind: "class" as const,
        path: ["util", "TextEncoder"],
        normalizedName: "util.TextEncoder",
    },
    member: {
        kind: "method" as const,
        name: "encodeInto",
        static: false,
    },
    invoke: {
        kind: "call" as const,
    },
    signature: {
        parameters: [{ index: 0, type: { text: "?string" } }],
        returnType: { text: "Uint8Array" },
    },
    provenance: {
        source: "official-declaration" as const,
        declarationLocations: [{ file: "api/@ohos.util.d.ts" }],
    },
};

const utilTextEncoderEncodeIntoCanonicalApiId = buildCanonicalApiId(utilTextEncoderEncodeIntoDescriptorInput);

const utilTextEncoderEncodeIntoDescriptor: CanonicalApiDescriptor = {
    canonicalApiId: utilTextEncoderEncodeIntoCanonicalApiId,
    ...utilTextEncoderEncodeIntoDescriptorInput,
};

const objectShapeAlphaDescriptorInput = {
    authority: "official" as const,
    domain: "openharmony" as const,
    moduleSpecifier: "@ohos.shapeProbe",
    logicalDeclarationFile: "api/@ohos.shapeProbe.d.ts",
    exportPath: [{ kind: "named" as const, name: "pick" }],
    declarationOwner: {
        kind: "file" as const,
        path: ["file"],
        normalizedName: "file",
    },
    member: {
        kind: "function" as const,
        name: "pick",
    },
    invoke: {
        kind: "call" as const,
    },
    signature: {
        parameters: [{ index: 0, type: { text: "{ alpha: string; shared?: number }" } }],
        returnType: { text: "void" },
    },
    provenance: {
        source: "official-declaration" as const,
        declarationLocations: [{ file: "api/@ohos.shapeProbe.d.ts" }],
    },
};

const objectShapeAlphaCanonicalApiId = buildCanonicalApiId(objectShapeAlphaDescriptorInput);

const objectShapeAlphaDescriptor: CanonicalApiDescriptor = {
    canonicalApiId: objectShapeAlphaCanonicalApiId,
    ...objectShapeAlphaDescriptorInput,
};

const objectShapeBetaDescriptorInput = {
    ...objectShapeAlphaDescriptorInput,
    signature: {
        parameters: [{ index: 0, type: { text: "{ beta: string; shared?: number }" } }],
        returnType: { text: "void" },
    },
};

const objectShapeBetaDescriptor: CanonicalApiDescriptor = {
    canonicalApiId: buildCanonicalApiId(objectShapeBetaDescriptorInput),
    ...objectShapeBetaDescriptorInput,
};

const callbackShapeDescriptorInput = {
    authority: "official" as const,
    domain: "openharmony" as const,
    moduleSpecifier: "@ohos.callbackProbe",
    logicalDeclarationFile: "api/@ohos.callbackProbe.d.ts",
    exportPath: [{ kind: "named" as const, name: "handle" }],
    declarationOwner: {
        kind: "file" as const,
        path: ["file"],
        normalizedName: "file",
    },
    member: {
        kind: "function" as const,
        name: "handle",
    },
    invoke: {
        kind: "call" as const,
    },
    signature: {
        parameters: [{ index: 0, type: { text: "(value: string) => void" } }],
        returnType: { text: "void" },
    },
    provenance: {
        source: "official-declaration" as const,
        declarationLocations: [{ file: "api/@ohos.callbackProbe.d.ts" }],
    },
};

const callbackShapeCanonicalApiId = buildCanonicalApiId(callbackShapeDescriptorInput);

const callbackShapeDescriptor: CanonicalApiDescriptor = {
    canonicalApiId: callbackShapeCanonicalApiId,
    ...callbackShapeDescriptorInput,
};

const nonCallbackShapeDescriptorInput = {
    ...callbackShapeDescriptorInput,
    signature: {
        parameters: [{ index: 0, type: { text: "string" } }],
        returnType: { text: "void" },
    },
};

const nonCallbackShapeDescriptor: CanonicalApiDescriptor = {
    canonicalApiId: buildCanonicalApiId(nonCallbackShapeDescriptorInput),
    ...nonCallbackShapeDescriptorInput,
};

const missingShapeAlphaDescriptorInput = {
    authority: "official" as const,
    domain: "openharmony" as const,
    moduleSpecifier: "@ohos.missingShapeProbe",
    logicalDeclarationFile: "api/@ohos.missingShapeProbe.d.ts",
    exportPath: [{ kind: "named" as const, name: "select" }],
    declarationOwner: {
        kind: "file" as const,
        path: ["file"],
        normalizedName: "file",
    },
    member: {
        kind: "function" as const,
        name: "select",
    },
    invoke: {
        kind: "call" as const,
    },
    signature: {
        parameters: [{ index: 0, type: { text: "OptionA" } }],
        returnType: { text: "void" },
    },
    provenance: {
        source: "official-declaration" as const,
        declarationLocations: [{ file: "api/@ohos.missingShapeProbe.d.ts" }],
    },
};

const missingShapeAlphaDescriptor: CanonicalApiDescriptor = {
    canonicalApiId: buildCanonicalApiId(missingShapeAlphaDescriptorInput),
    ...missingShapeAlphaDescriptorInput,
};

const missingShapeBetaDescriptorInput = {
    ...missingShapeAlphaDescriptorInput,
    signature: {
        parameters: [{ index: 0, type: { text: "OptionB" } }],
        returnType: { text: "void" },
    },
};

const missingShapeBetaDescriptor: CanonicalApiDescriptor = {
    canonicalApiId: buildCanonicalApiId(missingShapeBetaDescriptorInput),
    ...missingShapeBetaDescriptorInput,
};

function makeAsset(): AssetDocumentBase {
    return {
        id: "asset.rule.official.http.request",
        plane: "rule",
        status: "official",
        surfaces: [{
            surfaceId: "surface.official.http.request",
            canonicalApiId: httpRequestCanonicalApiId,
            kind: "invoke",
            confidence: "certain",
            provenance: {
                source: "sdk",
                location: { file: "api/@ohos.net.http.d.ts", line: 1 },
            },
        }],
        bindings: [{
            bindingId: "binding.sink.official.http.request.arg0",
            surfaceId: "surface.official.http.request",
            canonicalApiId: httpRequestCanonicalApiId,
            assetId: "asset.rule.official.http.request",
            plane: "rule",
            role: "sink",
            endpoint: requestEndpoint,
            effectTemplateRefs: ["template.sink.official.http.request.arg0"],
            semanticsFamily: "network",
            completeness: "complete",
            confidence: "certain",
        }],
        effectTemplates: [{
            id: "template.sink.official.http.request.arg0",
            kind: "rule.sink",
            value: requestEndpoint,
            sinkKind: "network",
            confidence: "certain",
        }],
        provenance: { source: "manual" },
    };
}

function importKey(overrides: Partial<ImportMemberKey> = {}): ImportMemberKey {
    return {
        moduleSpecifier: "@ohos.net.http",
        importKind: "named",
        importedName: "request",
        localBindingId: "import:request",
        localName: "request",
        aliasChain: [],
        memberChain: ["request"],
        invokeKind: "call",
        argShape: {
            arity: 1,
            parameterTypes: ["http.HttpRequestOptions"],
            returnType: "Promise<http.HttpResponse>",
        },
        scopeEvidence: {
            sourceFile: "entry/src/main/ets/pages/Index.ets",
            enclosingMethodSignature: "@entry/src/main/ets/pages/Index.ets: Page.build()",
            shadowed: false,
        },
        ...overrides,
    };
}

function main(): void {
    const observedUnknownShape = importKey({
        argShape: {
            arity: 4,
            parameterTypes: ["unknown", "%unk", "%AC123.Shape", "string"],
            returnType: "@%unk/%unk",
            literalKinds: [{ index: 3, kind: "string" }],
            objectKeys: [{ index: 2, keys: ["payload"] }],
            callbackPositions: [1, 1],
        },
    });
    const fullKeyText = importMemberKeyString(observedUnknownShape);
    const candidateKeyText = importMemberCandidateKeyString(importMemberCandidateKeyFromImportMemberKey(observedUnknownShape));
    const constraints = knownShapeConstraintsFromImportMemberKey(observedUnknownShape);
    assert(fullKeyText.includes("parameterTypes") && fullKeyText.includes("returnType"), "full exact key must include signature shape");
    assert(!candidateKeyText.includes("parameterTypes") && !candidateKeyText.includes("returnType"), "candidate key must not include signature shape");
    assert(constraints.parameterTypes.length === 1 && constraints.parameterTypes[0].index === 3 && constraints.parameterTypes[0].type === "string", "unknown/%unk/%AC observed types must not enter known constraints");
    assert(!constraints.returnType, "unknown return type must not enter known constraints");
    assert(constraints.callbackPositions.length === 1 && constraints.callbackPositions[0] === 1, "callback positions must keep indexed shape evidence");

    const registry = createCanonicalApiRegistry([
        httpRequestDescriptor,
        routerPushUrlDescriptor,
        utilTextEncoderEncodeIntoDescriptor,
    ]);
    const resolver = new ApiOccurrenceResolver(registry);
    const assetIndex = createAssetIdentityIndex({
        canonicalApiRegistry: registry,
    });
    const asset = makeAsset();
    assetIndex.addAsset(asset);

    const resolved = resolver.resolve({
        rawOccurrenceId: "raw:entry:17:request",
        kind: "invoke",
        sourceLocation: { file: "entry/src/main/ets/pages/Index.ets", line: 17, column: 12 },
        ir: {
            methodSignatureText: "@%unk/%unk: request(%unk)",
            unknownSignature: true,
            memberName: "request",
            argCount: 1,
        },
        importEvidence: importKey(),
    });
    assert(resolved.status === "accepted", `official imported API occurrence should resolve, got ${resolved.status}:${resolved.reason}`);
    assert(resolved.canonicalApiId === httpRequestCanonicalApiId, "resolved occurrence should carry canonicalApiId");

    const defaultImportedRouter = resolver.resolve({
        rawOccurrenceId: "raw:entry:17:router.pushUrl",
        kind: "invoke",
        sourceLocation: { file: "entry/src/main/ets/pages/Index.ets", line: 17, column: 28 },
        ir: {
            methodSignatureText: "@%unk/%unk: pushUrl(%unk)",
            unknownSignature: true,
            memberName: "pushUrl",
            argCount: 1,
        },
        importEvidence: {
            moduleSpecifier: "@ohos.router",
            importKind: "default",
            importedName: "default",
            localBindingId: "entry/src/main/ets/pages/Index.ets:router",
            localName: "router",
            aliasChain: [],
            memberChain: ["pushUrl"],
            invokeKind: "call",
            argShape: { arity: 1, parameterTypes: ["router.RouterOptions"], returnType: "Promise<void>" },
            scopeEvidence: {
                sourceFile: "entry/src/main/ets/pages/Index.ets",
                enclosingMethodSignature: "@entry/src/main/ets/pages/Index.ets: Page.build()",
                shadowed: false,
            },
        },
    });
    assert(defaultImportedRouter.status === "accepted", `default import should resolve by canonical default key, got ${defaultImportedRouter.status}:${defaultImportedRouter.reason}`);
    assert(defaultImportedRouter.canonicalApiId === routerPushUrlCanonicalApiId, "default import should resolve to @ohos.router.pushUrl canonicalApiId");

    const localNameAsIdentity = resolver.resolve({
        rawOccurrenceId: "raw:entry:17:router.localName",
        kind: "invoke",
        sourceLocation: { file: "entry/src/main/ets/pages/Index.ets", line: 17, column: 28 },
        ir: {
            methodSignatureText: "@%unk/%unk: pushUrl(%unk)",
            unknownSignature: true,
            memberName: "pushUrl",
            argCount: 1,
        },
        importEvidence: {
            moduleSpecifier: "@ohos.router",
            importKind: "default",
            importedName: "router",
            localBindingId: "entry/src/main/ets/pages/Index.ets:router",
            localName: "router",
            aliasChain: [],
            memberChain: ["pushUrl"],
            invokeKind: "call",
            argShape: { arity: 1, parameterTypes: ["router.RouterOptions"], returnType: "Promise<void>" },
            scopeEvidence: {
                sourceFile: "entry/src/main/ets/pages/Index.ets",
                enclosingMethodSignature: "@entry/src/main/ets/pages/Index.ets: Page.build()",
                shadowed: false,
            },
        },
    });
    assert(localNameAsIdentity.status === "unresolved", `local binding name must not be accepted as API identity, got ${localNameAsIdentity.status}:${localNameAsIdentity.reason}`);

    const nestedDefaultImportedUtil = resolver.resolve({
        rawOccurrenceId: "raw:entry:17:util.TextEncoder.encodeInto",
        kind: "invoke",
        sourceLocation: { file: "entry/src/main/ets/pages/Index.ets", line: 17, column: 28 },
        ir: {
            methodSignatureText: "@%unk/%unk: encodeInto(%unk)",
            unknownSignature: true,
            memberName: "encodeInto",
            argCount: 1,
        },
        importEvidence: {
            moduleSpecifier: "@ohos.util",
            importKind: "default",
            importedName: "default",
            localBindingId: "entry/src/main/ets/pages/Index.ets:util",
            localName: "util",
            aliasChain: [],
            memberChain: ["TextEncoder", "encodeInto"],
            invokeKind: "call",
            argShape: { arity: 1, parameterTypes: ["unknown"], returnType: "unknown" },
            scopeEvidence: {
                sourceFile: "entry/src/main/ets/pages/Index.ets",
                enclosingMethodSignature: "@entry/src/main/ets/pages/Index.ets: Page.build()",
                shadowed: false,
            },
        },
    });
    assert(nestedDefaultImportedUtil.status === "accepted", `nested default import should resolve, got ${nestedDefaultImportedUtil.status}:${nestedDefaultImportedUtil.reason}`);
    assert(nestedDefaultImportedUtil.canonicalApiId === utilTextEncoderEncodeIntoCanonicalApiId, "nested default import should resolve to util.TextEncoder.encodeInto canonicalApiId");

    const nestedNamespaceImportedUtil = resolver.resolve({
        rawOccurrenceId: "raw:entry:17:namespaceUtil.TextEncoder.encodeInto",
        kind: "invoke",
        sourceLocation: { file: "entry/src/main/ets/pages/Index.ets", line: 17, column: 28 },
        ir: {
            methodSignatureText: "@%unk/%unk: encodeInto(%unk)",
            unknownSignature: true,
            memberName: "encodeInto",
            argCount: 1,
        },
        importEvidence: {
            moduleSpecifier: "@ohos.util",
            importKind: "namespace",
            importedName: "*",
            localBindingId: "entry/src/main/ets/pages/Index.ets:util",
            localName: "util",
            aliasChain: [],
            memberChain: ["TextEncoder", "encodeInto"],
            invokeKind: "call",
            argShape: { arity: 1, parameterTypes: ["unknown"], returnType: "unknown" },
            scopeEvidence: {
                sourceFile: "entry/src/main/ets/pages/Index.ets",
                enclosingMethodSignature: "@entry/src/main/ets/pages/Index.ets: Page.build()",
                shadowed: false,
            },
        },
    });
    assert(nestedNamespaceImportedUtil.status === "accepted", `nested namespace import should resolve, got ${nestedNamespaceImportedUtil.status}:${nestedNamespaceImportedUtil.reason}`);
    assert(nestedNamespaceImportedUtil.canonicalApiId === utilTextEncoderEncodeIntoCanonicalApiId, "nested namespace import should resolve to util.TextEncoder.encodeInto canonicalApiId");

    const nakedNestedMember = resolver.resolve({
        rawOccurrenceId: "raw:entry:17:util.encodeInto",
        kind: "invoke",
        sourceLocation: { file: "entry/src/main/ets/pages/Index.ets", line: 17, column: 28 },
        ir: {
            methodSignatureText: "@%unk/%unk: encodeInto(%unk)",
            unknownSignature: true,
            memberName: "encodeInto",
            argCount: 1,
        },
        importEvidence: {
            moduleSpecifier: "@ohos.util",
            importKind: "default",
            importedName: "default",
            localBindingId: "entry/src/main/ets/pages/Index.ets:util",
            localName: "util",
            aliasChain: [],
            memberChain: ["encodeInto"],
            invokeKind: "call",
            argShape: { arity: 1, parameterTypes: ["unknown"], returnType: "unknown" },
            scopeEvidence: {
                sourceFile: "entry/src/main/ets/pages/Index.ets",
                enclosingMethodSignature: "@entry/src/main/ets/pages/Index.ets: Page.build()",
                shadowed: false,
            },
        },
    });
    assert(nakedNestedMember.status === "unresolved", `nested API must not resolve from a naked member name, got ${nakedNestedMember.status}:${nakedNestedMember.reason}`);

    const objectShapeRegistry = createCanonicalApiRegistry([
        objectShapeAlphaDescriptor,
        objectShapeBetaDescriptor,
    ]);
    const objectShapeResolved = new ApiOccurrenceResolver(objectShapeRegistry).resolve({
        rawOccurrenceId: "raw:entry:22:pick",
        kind: "invoke",
        sourceLocation: { file: "entry/src/main/ets/pages/Index.ets", line: 22 },
        ir: {
            methodSignatureText: "@%unk/%unk: pick(%unk)",
            unknownSignature: true,
            memberName: "pick",
            argCount: 1,
        },
        importEvidence: importKey({
            moduleSpecifier: "@ohos.shapeProbe",
            importKind: "named",
            importedName: "pick",
            localBindingId: "import:pick",
            localName: "pick",
            memberChain: ["pick"],
            argShape: {
                arity: 1,
                parameterTypes: ["unknown"],
                returnType: "unknown",
                literalKinds: [{ index: 0, kind: "object" }],
                objectKeys: [{ index: 0, keys: ["alpha"] }],
            },
        }),
    });
    assert(objectShapeResolved.status === "accepted", `object keys with declaration metadata should disambiguate, got ${objectShapeResolved.status}:${objectShapeResolved.reason}`);
    assert(objectShapeResolved.canonicalApiId === objectShapeAlphaCanonicalApiId, "object key evidence should select the matching overload");

    const callbackShapeRegistry = createCanonicalApiRegistry([
        callbackShapeDescriptor,
        nonCallbackShapeDescriptor,
    ]);
    const callbackShapeResolved = new ApiOccurrenceResolver(callbackShapeRegistry).resolve({
        rawOccurrenceId: "raw:entry:23:handle",
        kind: "invoke",
        sourceLocation: { file: "entry/src/main/ets/pages/Index.ets", line: 23 },
        ir: {
            methodSignatureText: "@%unk/%unk: handle(%unk)",
            unknownSignature: true,
            memberName: "handle",
            argCount: 1,
        },
        importEvidence: importKey({
            moduleSpecifier: "@ohos.callbackProbe",
            importKind: "named",
            importedName: "handle",
            localBindingId: "import:handle",
            localName: "handle",
            memberChain: ["handle"],
            argShape: {
                arity: 1,
                parameterTypes: ["unknown"],
                returnType: "unknown",
                literalKinds: [{ index: 0, kind: "function" }],
                callbackPositions: [0],
            },
        }),
    });
    assert(callbackShapeResolved.status === "accepted", `callback position should disambiguate callback overload, got ${callbackShapeResolved.status}:${callbackShapeResolved.reason}`);
    assert(callbackShapeResolved.canonicalApiId === callbackShapeCanonicalApiId, "callback position evidence should select the callback overload");

    const missingShapeRegistry = createCanonicalApiRegistry([
        missingShapeAlphaDescriptor,
        missingShapeBetaDescriptor,
    ]);
    const missingShapeResolved = new ApiOccurrenceResolver(missingShapeRegistry).resolve({
        rawOccurrenceId: "raw:entry:24:select",
        kind: "invoke",
        sourceLocation: { file: "entry/src/main/ets/pages/Index.ets", line: 24 },
        ir: {
            methodSignatureText: "@%unk/%unk: select(%unk)",
            unknownSignature: true,
            memberName: "select",
            argCount: 1,
        },
        importEvidence: importKey({
            moduleSpecifier: "@ohos.missingShapeProbe",
            importKind: "named",
            importedName: "select",
            localBindingId: "import:select",
            localName: "select",
            memberChain: ["select"],
            argShape: {
                arity: 1,
                parameterTypes: ["unknown"],
                returnType: "unknown",
                literalKinds: [{ index: 0, kind: "object" }],
                objectKeys: [{ index: 0, keys: ["alpha"] }],
            },
        }),
    });
    assert(missingShapeResolved.status === "ambiguous", `missing declaration metadata must not be accepted, got ${missingShapeResolved.status}:${missingShapeResolved.reason}`);
    assert(missingShapeResolved.reason === "import_member_candidate_missing_shape_metadata", `missing metadata should be explicit, got ${missingShapeResolved.reason}`);

    const bindings = assetIndex.findBindings(resolved.canonicalApiId!, { roles: ["sink"], endpoint: requestEndpoint });
    assert(bindings.length === 1, `canonicalApiId should find exactly one sink binding, got ${bindings.length}`);

    const template = assetIndex.getTemplate("template.sink.official.http.request.arg0");
    assert(template, "effect template should be indexed");
    const effect = projectBindingToEffect({ occurrence: resolved, binding: bindings[0], template });
    assert(effect.acceptedForPropagation, "resolved occurrence and exact endpoint should be accepted for propagation");
    assert(effect.identity.canonicalApiId === httpRequestCanonicalApiId, "effect identity should retain canonicalApiId");

    const wrongArity = resolver.resolve({
        rawOccurrenceId: "raw:entry:18:request",
        kind: "invoke",
        sourceLocation: { file: "entry/src/main/ets/pages/Index.ets", line: 18 },
        ir: {
            methodSignatureText: "@%unk/%unk: request(%unk,%unk)",
            unknownSignature: true,
            memberName: "request",
            argCount: 2,
        },
        importEvidence: importKey({
            argShape: { arity: 2, parameterTypes: ["http.HttpRequestOptions", "number"], returnType: "Promise<http.HttpResponse>" },
        }),
    });
    assert(wrongArity.status === "unresolved", `wrong arity should be unresolved, got ${wrongArity.status}`);

    const overloadedDescriptorInput = {
        ...httpRequestDescriptorInput,
        signature: {
            parameters: [{ index: 0, type: { text: "string" } }],
            returnType: { text: "Promise<http.HttpResponse>" },
        },
    };
    const overloadedRegistry = createCanonicalApiRegistry([
        httpRequestDescriptor,
        {
            canonicalApiId: buildCanonicalApiId(overloadedDescriptorInput),
            ...overloadedDescriptorInput,
        },
    ]);
    const overloaded = new ApiOccurrenceResolver(overloadedRegistry).resolve({
        rawOccurrenceId: "raw:entry:21:request",
        kind: "invoke",
        sourceLocation: { file: "entry/src/main/ets/pages/Index.ets", line: 21 },
        ir: {
            methodSignatureText: "@%unk/%unk: request(%unk)",
            unknownSignature: true,
            memberName: "request",
            argCount: 1,
        },
        importEvidence: importKey(),
    });
    assert(overloaded.status === "accepted", `exact import signature should select one overload, got ${overloaded.status}:${overloaded.reason}`);
    assert(overloaded.canonicalApiId === httpRequestCanonicalApiId, "import identity must distinguish overloads by parameter types");

    const shadowed = resolver.resolve({
        rawOccurrenceId: "raw:entry:19:request",
        kind: "invoke",
        sourceLocation: { file: "entry/src/main/ets/pages/Index.ets", line: 19 },
        ir: {
            methodSignatureText: "@%unk/%unk: request(%unk)",
            unknownSignature: true,
            memberName: "request",
            argCount: 1,
        },
        importEvidence: importKey({
            scopeEvidence: {
                sourceFile: "entry/src/main/ets/pages/Index.ets",
                enclosingMethodSignature: "@entry/src/main/ets/pages/Index.ets: Page.build()",
                shadowed: true,
            },
        }),
    });
    assert(shadowed.status === "rejected", `shadowed import should be rejected, got ${shadowed.status}`);

    const noEvidence = resolver.resolve({
        rawOccurrenceId: "raw:entry:20:request",
        kind: "invoke",
        sourceLocation: { file: "entry/src/main/ets/pages/Index.ets", line: 20 },
        ir: {
            methodSignatureText: "@%unk/%unk: request(%unk)",
            unknownSignature: true,
            memberName: "request",
            argCount: 1,
        },
    });
    assert(noEvidence.status === "unresolved", `missing identity evidence should be unresolved, got ${noEvidence.status}`);

    console.log("canonical_api_occurrence_identity_ok");
}

main();
