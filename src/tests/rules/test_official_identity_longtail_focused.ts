import { ApiOccurrenceResolver } from "../../core/api/occurrence/ApiOccurrenceResolver";
import { buildOfficialOccurrenceRecords } from "../../core/api/occurrence/OfficialOccurrenceInventory";
import {
    createCanonicalApiRegistry,
} from "../../core/api/identity/CanonicalApiRegistry";
import type { CanonicalApiDescriptor } from "../../core/api/identity/CanonicalApiDescriptor";
import { buildCanonicalApiId } from "../../core/api/identity/CanonicalApiId";
import type { ImportMemberKey } from "../../core/api/identity/ImportMemberKey";
import type { ReceiverMemberKey } from "../../core/api/identity/ReceiverMemberKey";
import type { RawApiOccurrence, ResolvedApiOccurrence } from "../../core/api/occurrence/ApiOccurrence";

type DescriptorInput = Omit<CanonicalApiDescriptor, "canonicalApiId">;

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function descriptor(input: DescriptorInput): CanonicalApiDescriptor {
    return {
        canonicalApiId: buildCanonicalApiId(input),
        ...input,
    };
}

function rawOccurrence(
    rawOccurrenceId: string,
    evidence: Partial<RawApiOccurrence>,
): RawApiOccurrence {
    return {
        rawOccurrenceId,
        kind: evidence.kind || "invoke",
        sourceLocation: evidence.sourceLocation || {
            file: "entry/src/main/ets/pages/IdentityLongtail.ets",
            line: 1,
            column: 1,
        },
        ir: {
            methodSignatureText: "@%unk/%unk: .unknown()",
            unknownSignature: true,
            ...(evidence.ir || {}),
        },
        ...evidence,
    };
}

function importKey(overrides: Partial<ImportMemberKey>): ImportMemberKey {
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
            sourceFile: "entry/src/main/ets/pages/IdentityLongtail.ets",
            enclosingMethodSignature: "@entry/src/main/ets/pages/IdentityLongtail.ets: Page.build()",
            shadowed: false,
        },
        ...overrides,
    };
}

function receiverKey(overrides: Partial<ReceiverMemberKey>): ReceiverMemberKey {
    return {
        moduleSpecifier: "@ohos.net.http",
        receiverType: "HttpRequest",
        memberName: "request",
        invokeKind: "call",
        argShape: {
            arity: 2,
            parameterTypes: ["string", "http.HttpRequestOptions"],
            returnType: "Promise<http.HttpResponse>",
        },
        provenance: {
            sourceFile: "entry/src/main/ets/pages/IdentityLongtail.ets",
            enclosingMethodSignature: "@entry/src/main/ets/pages/IdentityLongtail.ets: Page.load()",
            localName: "httpRequest",
            producerOccurrenceId: "occurrence:http.createHttp",
            producerCanonicalApiId: "api:official:openharmony:module=%40ohos.net.http:file=api%2F%40ohos.net.http.d.ts:export=named%3AcreateHttp:decl=file%3Afile:member=function%3AcreateHttp:invoke=call:params=none:ret=HttpRequest",
            producerMemberName: "createHttp",
        },
        ...overrides,
    };
}

const httpRequestFunction = descriptor({
    authority: "official",
    domain: "openharmony",
    moduleSpecifier: "@ohos.net.http",
    logicalDeclarationFile: "api/@ohos.net.http.d.ts",
    exportPath: [{ kind: "named", name: "request" }],
    declarationOwner: { kind: "file", path: ["file"], normalizedName: "file" },
    member: { kind: "function", name: "request" },
    invoke: { kind: "call" },
    signature: {
        parameters: [{ index: 0, type: { text: "http.HttpRequestOptions" } }],
        returnType: { text: "Promise<http.HttpResponse>" },
    },
    provenance: {
        source: "official-declaration",
        declarationLocations: [{ file: "api/@ohos.net.http.d.ts" }],
    },
});

const routerPushUrl = descriptor({
    authority: "official",
    domain: "openharmony",
    moduleSpecifier: "@ohos.router",
    logicalDeclarationFile: "api/@ohos.router.d.ts",
    exportPath: [{ kind: "default", name: "pushUrl" }],
    declarationOwner: { kind: "namespace", path: ["pushUrl"], normalizedName: "pushUrl" },
    member: { kind: "function", name: "pushUrl" },
    invoke: { kind: "call" },
    signature: {
        parameters: [{ index: 0, type: { text: "router.RouterOptions" } }],
        returnType: { text: "Promise<void>" },
    },
    provenance: {
        source: "official-declaration",
        declarationLocations: [{ file: "api/@ohos.router.d.ts" }],
    },
});

const hilogErrorRecordData = descriptor({
    authority: "official",
    domain: "openharmony",
    moduleSpecifier: "@ohos.hilog",
    logicalDeclarationFile: "api/@ohos.hilog.d.ts",
    exportPath: [{ kind: "namespace", name: "hilog" }],
    declarationOwner: { kind: "namespace", path: ["hilog"], normalizedName: "hilog" },
    member: { kind: "function", name: "error" },
    invoke: { kind: "call" },
    signature: {
        parameters: [
            { index: 0, type: { text: "number" } },
            { index: 1, type: { text: "string" } },
            { index: 2, type: { text: "string" } },
            { index: 3, rest: true, type: { text: "hilog.RecordData[]" } },
        ],
        returnType: { text: "void" },
    },
    provenance: {
        source: "official-declaration",
        declarationLocations: [{ file: "api/@ohos.hilog.d.ts" }],
    },
});

const { canonicalApiId: _hilogErrorRecordDataId, ...hilogErrorRecordDataInput } = hilogErrorRecordData;
const hilogErrorAnyData = descriptor({
    ...hilogErrorRecordDataInput,
    signature: {
        parameters: [
            { index: 0, type: { text: "number" } },
            { index: 1, type: { text: "string" } },
            { index: 2, type: { text: "string" } },
            { index: 3, rest: true, type: { text: "any[]" } },
        ],
        returnType: { text: "void" },
    },
});

const hilogErrorStringData = descriptor({
    ...hilogErrorRecordDataInput,
    signature: {
        parameters: [
            { index: 0, type: { text: "number" } },
            { index: 1, type: { text: "string" } },
            { index: 2, type: { text: "string" } },
            { index: 3, rest: true, type: { text: "string[]" } },
        ],
        returnType: { text: "void" },
    },
});

const emitterOnData = descriptor({
    authority: "official",
    domain: "openharmony",
    moduleSpecifier: "@ohos.events",
    logicalDeclarationFile: "api/@ohos.events.d.ts",
    exportPath: [{ kind: "named", name: "on" }],
    declarationOwner: { kind: "file", path: ["file"], normalizedName: "file" },
    member: { kind: "function", name: "on" },
    invoke: { kind: "call" },
    signature: {
        parameters: [
            { index: 0, type: { text: "'data'" } },
            { index: 1, type: { text: "(value: string) => void" } },
        ],
        returnType: { text: "void" },
    },
    provenance: {
        source: "official-declaration",
        declarationLocations: [{ file: "api/@ohos.events.d.ts" }],
    },
});

const { canonicalApiId: _emitterOnDataId, ...emitterOnDataInput } = emitterOnData;
const emitterOnError = descriptor({
    ...emitterOnDataInput,
    signature: {
        parameters: [
            { index: 0, type: { text: "'error'" } },
            { index: 1, type: { text: "(error: Error) => void" } },
        ],
        returnType: { text: "void" },
    },
});

const httpCreateHttp = descriptor({
    authority: "official",
    domain: "openharmony",
    moduleSpecifier: "@ohos.net.http",
    logicalDeclarationFile: "api/@ohos.net.http.d.ts",
    exportPath: [{ kind: "named", name: "createHttp" }],
    declarationOwner: { kind: "file", path: ["file"], normalizedName: "file" },
    member: { kind: "function", name: "createHttp" },
    invoke: { kind: "call" },
    signature: {
        parameters: [],
        returnType: { text: "HttpRequest" },
    },
    provenance: {
        source: "official-declaration",
        declarationLocations: [{ file: "api/@ohos.net.http.d.ts" }],
    },
});

const httpRequestInstance = descriptor({
    authority: "official",
    domain: "openharmony",
    moduleSpecifier: "@ohos.net.http",
    logicalDeclarationFile: "api/@ohos.net.http.d.ts",
    exportPath: [{ kind: "namespace", name: "http" }],
    declarationOwner: { kind: "interface", path: ["HttpRequest"], normalizedName: "HttpRequest" },
    member: { kind: "method", name: "request", static: false },
    invoke: { kind: "call" },
    signature: {
        parameters: [
            { index: 0, type: { text: "string" } },
            { index: 1, type: { text: "http.HttpRequestOptions" }, optional: true },
        ],
        returnType: { text: "Promise<http.HttpResponse>" },
    },
    provenance: {
        source: "official-declaration",
        declarationLocations: [{ file: "api/@ohos.net.http.d.ts" }],
    },
});

const otherRequestInstance = descriptor({
    authority: "official",
    domain: "openharmony",
    moduleSpecifier: "@ohos.net.http",
    logicalDeclarationFile: "api/@ohos.net.http.d.ts",
    exportPath: [{ kind: "namespace", name: "http" }],
    declarationOwner: { kind: "interface", path: ["OtherRequest"], normalizedName: "OtherRequest" },
    member: { kind: "method", name: "request", static: false },
    invoke: { kind: "call" },
    signature: {
        parameters: [
            { index: 0, type: { text: "string" } },
            { index: 1, type: { text: "http.HttpRequestOptions" }, optional: true },
        ],
        returnType: { text: "Promise<http.HttpResponse>" },
    },
    provenance: {
        source: "official-declaration",
        declarationLocations: [{ file: "api/@ohos.net.http.d.ts" }],
    },
});

const nullableStringEcho = descriptor({
    authority: "official",
    domain: "openharmony",
    moduleSpecifier: "@ohos.nullableProbe",
    logicalDeclarationFile: "api/@ohos.nullableProbe.d.ts",
    exportPath: [{ kind: "named", name: "echo" }],
    declarationOwner: { kind: "file", path: ["file"], normalizedName: "file" },
    member: { kind: "function", name: "echo" },
    invoke: { kind: "call" },
    signature: {
        parameters: [{ index: 0, type: { text: "?string" } }],
        returnType: { text: "Promise<nullableProbe.Result | undefined>" },
    },
    provenance: {
        source: "official-declaration",
        declarationLocations: [{ file: "api/@ohos.nullableProbe.d.ts" }],
    },
});

const shapeAlpha = descriptor({
    authority: "official",
    domain: "openharmony",
    moduleSpecifier: "@ohos.shapeProbe",
    logicalDeclarationFile: "api/@ohos.shapeProbe.d.ts",
    exportPath: [{ kind: "named", name: "select" }],
    declarationOwner: { kind: "file", path: ["file"], normalizedName: "file" },
    member: { kind: "function", name: "select" },
    invoke: { kind: "call" },
    signature: {
        parameters: [{ index: 0, type: { text: "{ alpha: string; shared?: number }" } }],
        returnType: { text: "void" },
    },
    provenance: {
        source: "official-declaration",
        declarationLocations: [{ file: "api/@ohos.shapeProbe.d.ts" }],
    },
});

const { canonicalApiId: _shapeAlphaId, ...shapeAlphaInput } = shapeAlpha;
const shapeBeta = descriptor({
    ...shapeAlphaInput,
    signature: {
        parameters: [{ index: 0, type: { text: "{ beta: string; shared?: number }" } }],
        returnType: { text: "void" },
    },
});

const callbackHandle = descriptor({
    authority: "official",
    domain: "openharmony",
    moduleSpecifier: "@ohos.callbackProbe",
    logicalDeclarationFile: "api/@ohos.callbackProbe.d.ts",
    exportPath: [{ kind: "named", name: "handle" }],
    declarationOwner: { kind: "file", path: ["file"], normalizedName: "file" },
    member: { kind: "function", name: "handle" },
    invoke: { kind: "call" },
    signature: {
        parameters: [{ index: 0, type: { text: "(value: string) => void" } }],
        returnType: { text: "void" },
    },
    provenance: {
        source: "official-declaration",
        declarationLocations: [{ file: "api/@ohos.callbackProbe.d.ts" }],
    },
});

const { canonicalApiId: _callbackHandleId, ...callbackHandleInput } = callbackHandle;
const nonCallbackHandle = descriptor({
    ...callbackHandleInput,
    signature: {
        parameters: [{ index: 0, type: { text: "string" } }],
        returnType: { text: "void" },
    },
});

const imageComponent = descriptor({
    authority: "official",
    domain: "arkui",
    moduleSpecifier: "arkui.component.Image",
    logicalDeclarationFile: "arkui/component/Image.d.ets",
    exportPath: [{ kind: "component", name: "Image" }],
    declarationOwner: { kind: "interface", path: ["ImageInterface"], normalizedName: "ImageInterface" },
    member: { kind: "function", name: "call" },
    invoke: { kind: "call" },
    signature: {
        parameters: [{ index: 0, type: { text: "ResourceStr" } }],
        returnType: { text: "ImageAttribute" },
    },
    provenance: {
        source: "official-declaration",
        declarationLocations: [{ file: "arkui/component/Image.d.ets" }],
    },
});

const textComponent = descriptor({
    authority: "official",
    domain: "arkui",
    moduleSpecifier: "@internal/component/ets/text",
    logicalDeclarationFile: "api/@internal/component/ets/text.d.ts",
    exportPath: [{ kind: "component", name: "Text" }],
    declarationOwner: { kind: "interface", path: ["TextInterface"], normalizedName: "TextInterface" },
    member: { kind: "function", name: "call" },
    invoke: { kind: "call" },
    signature: {
        parameters: [
            { index: 0, optional: true, type: { text: "string | Resource" } },
            { index: 1, optional: true, type: { text: "TextOptions" } },
        ],
        returnType: { text: "TextAttribute" },
    },
    provenance: {
        source: "official-declaration",
        declarationLocations: [{ file: "api/@internal/component/ets/text.d.ts" }],
    },
});

const imageOnClick = descriptor({
    authority: "official",
    domain: "arkui",
    moduleSpecifier: "arkui.component.Image",
    logicalDeclarationFile: "arkui/component/Image.d.ets",
    exportPath: [{ kind: "component", name: "Image" }],
    declarationOwner: { kind: "interface", path: ["ImageAttribute"], normalizedName: "ImageAttribute" },
    member: { kind: "component-event", name: "onClick" },
    invoke: { kind: "component-chain" },
    signature: {
        parameters: [{ index: 0, type: { text: "(event: ClickEvent) => void" } }],
        returnType: { text: "ImageAttribute" },
    },
    provenance: {
        source: "official-declaration",
        declarationLocations: [{ file: "arkui/component/Image.d.ets" }],
    },
});

const { canonicalApiId: _imageOnClickId, ...imageOnClickInput } = imageOnClick;
const imageOnClickDuplicate = descriptor({
    ...imageOnClickInput,
    logicalDeclarationFile: "arkui/component/Image.duplicate.d.ets",
    signature: {
        parameters: [{ index: 0, type: { text: "(event: ClickEvent) => void" } }],
        returnType: { text: "DuplicatedImageAttribute" },
    },
    provenance: {
        source: "official-declaration",
        declarationLocations: [{ file: "arkui/component/Image.duplicate.d.ets" }],
    },
});

const stateDecorator = descriptor({
    authority: "official",
    domain: "arkui",
    moduleSpecifier: "arkui.decorator.State",
    logicalDeclarationFile: "arkui/decorators.d.ets",
    exportPath: [{ kind: "named", name: "State" }],
    declarationOwner: { kind: "file", path: ["file"], normalizedName: "file" },
    member: { kind: "decorator", name: "State" },
    invoke: { kind: "decorator" },
    signature: {
        parameters: [],
        returnType: { text: "void" },
    },
    provenance: {
        source: "official-declaration",
        declarationLocations: [{ file: "arkui/decorators.d.ets" }],
    },
});

const prefsTokenRead = descriptor({
    authority: "official",
    domain: "openharmony",
    moduleSpecifier: "@ohos.preferences",
    logicalDeclarationFile: "api/@ohos.preferences.d.ts",
    exportPath: [{ kind: "namespace", name: "preferences" }],
    declarationOwner: { kind: "interface", path: ["Preferences"], normalizedName: "Preferences" },
    member: { kind: "getter", name: "token" },
    invoke: { kind: "property-read" },
    signature: {
        parameters: [],
        returnType: { text: "string" },
    },
    provenance: {
        source: "official-declaration",
        declarationLocations: [{ file: "api/@ohos.preferences.d.ts" }],
    },
});

const prefsTokenWrite = descriptor({
    authority: "official",
    domain: "openharmony",
    moduleSpecifier: "@ohos.preferences",
    logicalDeclarationFile: "api/@ohos.preferences.d.ts",
    exportPath: [{ kind: "namespace", name: "preferences" }],
    declarationOwner: { kind: "interface", path: ["Preferences"], normalizedName: "Preferences" },
    member: { kind: "setter", name: "token" },
    invoke: { kind: "property-write" },
    signature: {
        parameters: [{ index: 0, type: { text: "string" } }],
        returnType: { text: "void" },
    },
    provenance: {
        source: "official-declaration",
        declarationLocations: [{ file: "api/@ohos.preferences.d.ts" }],
    },
});

const pureCatalogReceiverMember = descriptor({
    authority: "official",
    domain: "openharmony",
    moduleSpecifier: "@ohos.catalogOnly",
    logicalDeclarationFile: "api/@ohos.catalogOnly.d.ts",
    exportPath: [{ kind: "namespace", name: "catalogOnly" }],
    declarationOwner: { kind: "type", path: ["CatalogOnly"], normalizedName: "CatalogOnly" },
    member: { kind: "method", name: "request", static: false },
    invoke: { kind: "call" },
    signature: {
        parameters: [{ index: 0, type: { text: "string" } }],
        returnType: { text: "void" },
    },
    provenance: {
        source: "official-declaration",
        declarationLocations: [{ file: "api/@ohos.catalogOnly.d.ts" }],
    },
});

const projectStateDecorator = descriptor({
    authority: "project",
    domain: "local",
    moduleSpecifier: "entry/src/main/ets/pages/IdentityLongtail",
    logicalDeclarationFile: "entry/src/main/ets/pages/IdentityLongtail.ets",
    exportPath: [{ kind: "named", name: "State" }],
    declarationOwner: { kind: "file", path: ["file"], normalizedName: "file" },
    member: { kind: "decorator", name: "State" },
    invoke: { kind: "decorator" },
    signature: {
        parameters: [],
        returnType: { text: "void" },
    },
    provenance: {
        source: "project-declaration",
        declarationLocations: [{ file: "entry/src/main/ets/pages/IdentityLongtail.ets" }],
    },
});

const registry = createCanonicalApiRegistry([
    httpRequestFunction,
    routerPushUrl,
    hilogErrorRecordData,
    hilogErrorStringData,
    httpCreateHttp,
    httpRequestInstance,
    otherRequestInstance,
    nullableStringEcho,
    shapeAlpha,
    shapeBeta,
    callbackHandle,
    nonCallbackHandle,
    emitterOnData,
    emitterOnError,
    imageComponent,
    textComponent,
    imageOnClick,
    stateDecorator,
    prefsTokenRead,
    prefsTokenWrite,
    pureCatalogReceiverMember,
]);

const resolver = new ApiOccurrenceResolver(registry);

function expectAccepted(
    label: string,
    raw: RawApiOccurrence,
    expectedCanonicalApiId: string,
    expectedResolutionKind?: ResolvedApiOccurrence["resolutionKind"],
): ResolvedApiOccurrence {
    const resolved = resolver.resolve(raw);
    assert(
        resolved.status === "accepted",
        `${label} should be accepted, got ${resolved.status}:${resolved.reason}`,
    );
    assert(resolved.canonicalApiId === expectedCanonicalApiId, `${label} should resolve expected canonicalApiId`);
    if (expectedResolutionKind) {
        assert(resolved.resolutionKind === expectedResolutionKind, `${label} should resolve by ${expectedResolutionKind}, got ${resolved.resolutionKind}`);
    }
    return resolved;
}

function expectStatus(
    label: string,
    raw: RawApiOccurrence,
    expectedStatus: ResolvedApiOccurrence["status"],
    expectedReason?: string,
): ResolvedApiOccurrence {
    const resolved = resolver.resolve(raw);
    assert(
        resolved.status === expectedStatus,
        `${label} should be ${expectedStatus}, got ${resolved.status}:${resolved.reason}`,
    );
    if (expectedReason) {
        assert(resolved.reason === expectedReason, `${label} should have reason ${expectedReason}, got ${resolved.reason}`);
    }
    return resolved;
}

function testImportBinding(): void {
    expectAccepted(
        "named import",
        rawOccurrence("raw:named-request", {
            ir: { memberName: "request", argCount: 1, unknownSignature: true },
            importEvidence: importKey({}),
        }),
        httpRequestFunction.canonicalApiId,
        "import-member",
    );

    expectAccepted(
        "named import alias",
        rawOccurrence("raw:named-request-alias", {
            ir: { memberName: "sendRequest", argCount: 1, unknownSignature: true },
            importEvidence: importKey({
                localBindingId: "import:sendRequest",
                localName: "sendRequest",
                aliasChain: ["request", "sendRequest"],
            }),
        }),
        httpRequestFunction.canonicalApiId,
        "import-member",
    );

    expectAccepted(
        "default import member",
        rawOccurrence("raw:default-router-pushUrl", {
            ir: { memberName: "pushUrl", argCount: 1, unknownSignature: true },
            importEvidence: importKey({
                moduleSpecifier: "@ohos.router",
                importKind: "default",
                importedName: "default",
                localBindingId: "import:router",
                localName: "router",
                memberChain: ["pushUrl"],
                argShape: {
                    arity: 1,
                    parameterTypes: ["router.RouterOptions"],
                    returnType: "Promise<void>",
                },
            }),
        }),
        routerPushUrl.canonicalApiId,
        "import-member",
    );

    expectAccepted(
        "namespace import member",
        rawOccurrence("raw:namespace-hilog-error", {
            ir: { memberName: "error", argCount: 4, unknownSignature: true },
            importEvidence: importKey({
                moduleSpecifier: "@ohos.hilog",
                importKind: "namespace",
                importedName: "*",
                localBindingId: "import:hilog",
                localName: "hilog",
                memberChain: ["error"],
                argShape: {
                    arity: 4,
                    parameterTypes: ["number", "string", "string", "hilog.RecordData[]"],
                    returnType: "void",
                    spreadPositions: [3],
                },
            }),
        }),
        hilogErrorRecordData.canonicalApiId,
        "import-member",
    );

    expectStatus(
        "shadowed import",
        rawOccurrence("raw:shadowed-request", {
            ir: { memberName: "request", argCount: 1, unknownSignature: true },
            importEvidence: importKey({
                scopeEvidence: {
                    sourceFile: "entry/src/main/ets/pages/IdentityLongtail.ets",
                    enclosingMethodSignature: "@entry/src/main/ets/pages/IdentityLongtail.ets: Page.build()",
                    shadowed: true,
                },
            }),
        }),
        "rejected",
        "import_binding_shadowed",
    );
}

function testFactoryReturnReceiver(): void {
    const createHttp = expectAccepted(
        "http.createHttp producer",
        rawOccurrence("raw:http-createHttp", {
            ir: { memberName: "createHttp", argCount: 0, unknownSignature: true },
            importEvidence: importKey({
                moduleSpecifier: "@ohos.net.http",
                importKind: "named",
                importedName: "createHttp",
                localBindingId: "import:createHttp",
                localName: "createHttp",
                memberChain: ["createHttp"],
                argShape: {
                    arity: 0,
                    parameterTypes: [],
                    returnType: "HttpRequest",
                },
            }),
        }),
        httpCreateHttp.canonicalApiId,
        "import-member",
    );

    expectAccepted(
        "factory return receiver",
        rawOccurrence("raw:httpRequest-request", {
            ir: {
                invokeExprKind: "ArkInstanceInvokeExpr",
                receiverText: "httpRequest",
                memberName: "request",
                argCount: 2,
                unknownSignature: true,
            },
            receiverEvidence: receiverKey({
                provenance: {
                    ...receiverKey({}).provenance,
                    producerOccurrenceId: createHttp.occurrenceId,
                    producerCanonicalApiId: createHttp.canonicalApiId,
                },
            }),
        }),
        httpRequestInstance.canonicalApiId,
        "receiver-member",
    );

    expectAccepted(
        "factory return receiver nullable promise type",
        rawOccurrence("raw:httpRequest-request-nullable-promise", {
            ir: {
                invokeExprKind: "ArkInstanceInvokeExpr",
                receiverText: "httpRequest",
                memberName: "request",
                argCount: 2,
                unknownSignature: true,
            },
            receiverEvidence: receiverKey({
                receiverType: "Promise<http.HttpRequest | undefined>",
                provenance: {
                    ...receiverKey({}).provenance,
                    producerOccurrenceId: createHttp.occurrenceId,
                    producerCanonicalApiId: createHttp.canonicalApiId,
                },
            }),
        }),
        httpRequestInstance.canonicalApiId,
        "receiver-member",
    );

    expectStatus(
        "factory return receiver union remains ambiguous",
        rawOccurrence("raw:httpRequest-request-union", {
            ir: {
                invokeExprKind: "ArkInstanceInvokeExpr",
                receiverText: "httpRequest",
                memberName: "request",
                argCount: 2,
                unknownSignature: true,
            },
            receiverEvidence: receiverKey({
                receiverType: "HttpRequest | OtherRequest",
                provenance: {
                    ...receiverKey({}).provenance,
                    producerOccurrenceId: createHttp.occurrenceId,
                    producerCanonicalApiId: createHttp.canonicalApiId,
                },
            }),
        }),
        "ambiguous",
        "receiver_member_candidate_exact_ambiguous",
    );

    expectStatus(
        "ambiguous receiver provenance",
        rawOccurrence("raw:httpRequest-request-ambiguous", {
            ir: { receiverText: "req", memberName: "request", argCount: 2, unknownSignature: true },
            receiverAmbiguityEvidence: {
                localName: "req",
                candidates: [
                    {
                        moduleSpecifier: "@ohos.net.http",
                        receiverType: "HttpRequest",
                        sourceFile: "entry/src/main/ets/pages/IdentityLongtail.ets",
                        enclosingMethodSignature: "@entry/src/main/ets/pages/IdentityLongtail.ets: Page.load()",
                        localName: "req",
                    },
                    {
                        moduleSpecifier: "@ohos.other",
                        receiverType: "HttpRequest",
                        sourceFile: "entry/src/main/ets/pages/IdentityLongtail.ets",
                        enclosingMethodSignature: "@entry/src/main/ets/pages/IdentityLongtail.ets: Page.load()",
                        localName: "req",
                    },
                ],
            },
        }),
        "ambiguous",
        "receiver_provenance_ambiguous",
    );
}

function testShapeDisambiguation(): void {
    expectAccepted(
        "nullable declaration type accepts stable observed type",
        rawOccurrence("raw:nullable-echo", {
            ir: { memberName: "echo", argCount: 1, unknownSignature: true },
            importEvidence: importKey({
                moduleSpecifier: "@ohos.nullableProbe",
                importKind: "named",
                importedName: "echo",
                localBindingId: "import:echo",
                localName: "echo",
                memberChain: ["echo"],
                argShape: {
                    arity: 1,
                    parameterTypes: ["string"],
                    returnType: "Promise<nullableProbe.Result>",
                },
            }),
        }),
        nullableStringEcho.canonicalApiId,
        "import-member",
    );

    expectAccepted(
        "hilog rest typed spread",
        rawOccurrence("raw:hilog-error-recorddata", {
            ir: { memberName: "error", argCount: 4, unknownSignature: true },
            importEvidence: importKey({
                moduleSpecifier: "@ohos.hilog",
                importKind: "namespace",
                importedName: "*",
                localBindingId: "import:hilog",
                localName: "hilog",
                memberChain: ["error"],
                argShape: {
                    arity: 4,
                    parameterTypes: ["number", "string", "string", "hilog.RecordData[]"],
                    returnType: "void",
                    spreadPositions: [3],
                },
            }),
        }),
        hilogErrorRecordData.canonicalApiId,
        "import-member",
    );

    expectStatus(
        "hilog unknown rest remains ambiguous",
        rawOccurrence("raw:hilog-error-unknown-rest", {
            ir: { memberName: "error", argCount: 4, unknownSignature: true },
            importEvidence: importKey({
                moduleSpecifier: "@ohos.hilog",
                importKind: "namespace",
                importedName: "*",
                localBindingId: "import:hilog",
                localName: "hilog",
                memberChain: ["error"],
                argShape: {
                    arity: 4,
                    parameterTypes: ["number", "string", "string", "unknown"],
                    returnType: "void",
                    spreadPositions: [3],
                },
            }),
        }),
        "ambiguous",
        "import_member_candidate_exact_ambiguous",
    );

    expectAccepted(
        "hilog rest accepts super declaration arity",
        rawOccurrence("raw:hilog-error-rest-five", {
            ir: { memberName: "error", argCount: 5, unknownSignature: true },
            importEvidence: importKey({
                moduleSpecifier: "@ohos.hilog",
                importKind: "namespace",
                importedName: "*",
                localBindingId: "import:hilog",
                localName: "hilog",
                memberChain: ["error"],
                argShape: {
                    arity: 5,
                    parameterTypes: ["number", "string", "string", "hilog.RecordData", "hilog.RecordData"],
                    returnType: "void",
                },
            }),
        }),
        hilogErrorRecordData.canonicalApiId,
        "import-member",
    );

    const anyRestRegistry = createCanonicalApiRegistry([hilogErrorRecordData, hilogErrorAnyData]);
    const anyRestResolver = new ApiOccurrenceResolver(anyRestRegistry);
    const stringRestResolved = anyRestResolver.resolve(rawOccurrence("raw:hilog-error-string-rest-to-any", {
        ir: { memberName: "error", argCount: 4, unknownSignature: true },
        importEvidence: importKey({
            moduleSpecifier: "@ohos.hilog",
            importKind: "namespace",
            importedName: "*",
            localBindingId: "import:hilog",
            localName: "hilog",
            memberChain: ["error"],
            argShape: {
                arity: 4,
                parameterTypes: ["number", "string", "string", "string[]"],
                returnType: "void",
                literalKinds: [{ index: 3, kind: "array" }],
            },
        }),
    }));
    assert(stringRestResolved.status === "accepted", `string rest should match declared any[] rest, got ${stringRestResolved.status}:${stringRestResolved.reason}`);
    assert(stringRestResolved.canonicalApiId === hilogErrorAnyData.canonicalApiId, "string rest should resolve to the declared any[] rest overload");

    const unknownRestResolved = anyRestResolver.resolve(rawOccurrence("raw:hilog-error-any-registry-unknown-rest", {
        ir: { memberName: "error", argCount: 4, unknownSignature: true },
        importEvidence: importKey({
            moduleSpecifier: "@ohos.hilog",
            importKind: "namespace",
            importedName: "*",
            localBindingId: "import:hilog",
            localName: "hilog",
            memberChain: ["error"],
            argShape: {
                arity: 4,
                parameterTypes: ["number", "string", "string", "unknown"],
                returnType: "void",
            },
        }),
    }));
    assert(unknownRestResolved.status === "ambiguous", `unknown rest must remain ambiguous with any[] and RecordData[] overloads, got ${unknownRestResolved.status}:${unknownRestResolved.reason}`);

    expectAccepted(
        "object keys disambiguate overload",
        rawOccurrence("raw:shape-alpha", {
            ir: { memberName: "select", argCount: 1, unknownSignature: true },
            importEvidence: importKey({
                moduleSpecifier: "@ohos.shapeProbe",
                importKind: "named",
                importedName: "select",
                localBindingId: "import:select",
                localName: "select",
                memberChain: ["select"],
                argShape: {
                    arity: 1,
                    parameterTypes: ["unknown"],
                    literalKinds: [{ index: 0, kind: "object" }],
                    objectKeys: [{ index: 0, keys: ["alpha"] }],
                },
            }),
        }),
        shapeAlpha.canonicalApiId,
        "import-member",
    );

    expectAccepted(
        "callback position disambiguates overload",
        rawOccurrence("raw:callback-handle", {
            ir: { memberName: "handle", argCount: 1, unknownSignature: true },
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
                    literalKinds: [{ index: 0, kind: "function" }],
                    callbackPositions: [0],
                },
            }),
        }),
        callbackHandle.canonicalApiId,
        "import-member",
    );

    expectAccepted(
        "event literal and callback position disambiguate overload",
        rawOccurrence("raw:event-literal-data", {
            ir: { memberName: "on", argCount: 2, unknownSignature: true },
            importEvidence: importKey({
                moduleSpecifier: "@ohos.events",
                importKind: "named",
                importedName: "on",
                localBindingId: "import:on",
                localName: "on",
                memberChain: ["on"],
                argShape: {
                    arity: 2,
                    parameterTypes: ["unknown", "unknown"],
                    literalKinds: [{ index: 0, kind: "string" }, { index: 1, kind: "function" }],
                    literalValues: [{ index: 0, value: "data" }],
                    callbackPositions: [1],
                },
            }),
        }),
        emitterOnData.canonicalApiId,
        "import-member",
    );

    expectStatus(
        "event literal with no declaration match stays unresolved",
        rawOccurrence("raw:event-literal-close", {
            ir: { memberName: "on", argCount: 2, unknownSignature: true },
            importEvidence: importKey({
                moduleSpecifier: "@ohos.events",
                importKind: "named",
                importedName: "on",
                localBindingId: "import:on",
                localName: "on",
                memberChain: ["on"],
                argShape: {
                    arity: 2,
                    parameterTypes: ["unknown", "unknown"],
                    literalKinds: [{ index: 0, kind: "string" }, { index: 1, kind: "function" }],
                    literalValues: [{ index: 0, value: "close" }],
                    callbackPositions: [1],
                },
            }),
        }),
        "unresolved",
        "import_member_shape_constraints_no_candidate",
    );
}

function testArkUiDecoratorAndProperty(): void {
    expectAccepted(
        "ArkUI component",
        rawOccurrence("raw:arkui-image", {
            kind: "component-chain",
            ir: { memberName: "Image", argCount: 1, unknownSignature: true },
            arkuiComponentEvidence: {
                componentName: "Image",
                memberName: "call",
                invokeKind: "call",
                argShape: {
                    arity: 1,
                    parameterTypes: ["ResourceStr"],
                    returnType: "ImageAttribute",
                },
                sourceFile: "entry/src/main/ets/pages/IdentityLongtail.ets",
            },
        }),
        imageComponent.canonicalApiId,
        "arkui-component",
    );

    expectAccepted(
        "ArkUI builtin component return type prefix",
        rawOccurrence("raw:arkui-text-builtin-return", {
            kind: "component-chain",
            ir: {
                methodSignatureText: "@arkui-builtin/arkui_components.d.ts: %dflt.Text(string|@arkui-builtin/arkui_components.d.ts: Resource)",
                memberName: "Text",
                argCount: 1,
                argTypes: ["string"],
                unknownSignature: false,
            },
            arkuiComponentEvidence: {
                componentName: "Text",
                memberName: "call",
                invokeKind: "call",
                argShape: {
                    arity: 1,
                    parameterTypes: ["string"],
                    returnType: "@arkui-builtin/arkui_components.d.ts: TextAttribute",
                },
                sourceFile: "entry/src/main/ets/pages/IdentityLongtail.ets",
            },
        }),
        textComponent.canonicalApiId,
        "arkui-component",
    );

    expectAccepted(
        "decorator",
        rawOccurrence("raw:decorator-state", {
            kind: "decorator",
            ir: { memberName: "State", unknownSignature: true },
            decoratorEvidence: {
                decoratorName: "State",
                ownerKind: "field",
                ownerName: "message",
                sourceFile: "entry/src/main/ets/pages/IdentityLongtail.ets",
            },
        }),
        stateDecorator.canonicalApiId,
        "decorator-entry",
    );

    expectAccepted(
        "ArkUI event chain",
        rawOccurrence("raw:arkui-image-onClick", {
            kind: "component-chain",
            ir: { memberName: "onClick", argCount: 1, unknownSignature: true },
            arkuiEvidence: {
                componentName: "Image",
                attributeOwner: "ImageAttribute",
                eventName: "onClick",
                callbackArgCount: 1,
                sourceFile: "entry/src/main/ets/pages/IdentityLongtail.ets",
            },
        }),
        imageOnClick.canonicalApiId,
        "arkui-chain",
    );

    const ambiguousArkUiRegistry = createCanonicalApiRegistry([imageOnClick, imageOnClickDuplicate]);
    const ambiguousArkUiResolved = new ApiOccurrenceResolver(ambiguousArkUiRegistry).resolve(rawOccurrence("raw:arkui-image-onClick-ambiguous", {
        kind: "component-chain",
        ir: { memberName: "onClick", argCount: 1, unknownSignature: true },
        arkuiEvidence: {
            componentName: "Image",
            attributeOwner: "ImageAttribute",
            eventName: "onClick",
            callbackArgCount: 1,
            sourceFile: "entry/src/main/ets/pages/IdentityLongtail.ets",
        },
    }));
    assert(ambiguousArkUiResolved.status === "ambiguous", `duplicated ArkUI chain candidate must be ambiguous, got ${ambiguousArkUiResolved.status}:${ambiguousArkUiResolved.reason}`);

    expectAccepted(
        "property read",
        rawOccurrence("raw:preferences-token-read", {
            kind: "property-access",
            ir: {
                receiverText: "prefs",
                memberName: "token",
                propertyAccessKind: "read",
                unknownSignature: true,
            },
            receiverEvidence: receiverKey({
                moduleSpecifier: "@ohos.preferences",
                receiverType: "Preferences",
                memberName: "token",
                invokeKind: "property-read",
                argShape: {
                    arity: 0,
                    parameterTypes: [],
                    returnType: "string",
                },
                provenance: {
                    sourceFile: "entry/src/main/ets/pages/IdentityLongtail.ets",
                    enclosingMethodSignature: "@entry/src/main/ets/pages/IdentityLongtail.ets: Page.loadPrefs()",
                    localName: "prefs",
                },
            }),
        }),
        prefsTokenRead.canonicalApiId,
        "receiver-member",
    );

    expectAccepted(
        "property write",
        rawOccurrence("raw:preferences-token-write", {
            kind: "property-access",
            ir: {
                receiverText: "prefs",
                memberName: "token",
                propertyAccessKind: "write",
                argCount: 1,
                unknownSignature: true,
            },
            receiverEvidence: receiverKey({
                moduleSpecifier: "@ohos.preferences",
                receiverType: "Preferences",
                memberName: "token",
                invokeKind: "property-write",
                argShape: {
                    arity: 1,
                    parameterTypes: ["string"],
                    returnType: "void",
                },
                provenance: {
                    sourceFile: "entry/src/main/ets/pages/IdentityLongtail.ets",
                    enclosingMethodSignature: "@entry/src/main/ets/pages/IdentityLongtail.ets: Page.loadPrefs()",
                    localName: "prefs",
                },
            }),
        }),
        prefsTokenWrite.canonicalApiId,
        "receiver-member",
    );

    expectStatus(
        "property write RHS shape mismatch",
        rawOccurrence("raw:preferences-token-write-number", {
            kind: "property-access",
            ir: {
                receiverText: "prefs",
                memberName: "token",
                propertyAccessKind: "write",
                argCount: 1,
                unknownSignature: true,
            },
            receiverEvidence: receiverKey({
                moduleSpecifier: "@ohos.preferences",
                receiverType: "Preferences",
                memberName: "token",
                invokeKind: "property-write",
                argShape: {
                    arity: 1,
                    parameterTypes: ["number"],
                    returnType: "void",
                },
                provenance: {
                    sourceFile: "entry/src/main/ets/pages/IdentityLongtail.ets",
                    enclosingMethodSignature: "@entry/src/main/ets/pages/IdentityLongtail.ets: Page.loadPrefs()",
                    localName: "prefs",
                },
            }),
        }),
        "unresolved",
        "receiver_member_shape_constraints_no_candidate",
    );

    expectStatus(
        "pure type catalog member is not callable receiver API",
        rawOccurrence("raw:pure-type-receiver-member", {
            ir: {
                invokeExprKind: "ArkInstanceInvokeExpr",
                receiverText: "catalog",
                memberName: "request",
                argCount: 1,
                unknownSignature: true,
            },
            receiverEvidence: receiverKey({
                moduleSpecifier: "@ohos.catalogOnly",
                receiverType: "CatalogOnly",
                memberName: "request",
                invokeKind: "call",
                argShape: {
                    arity: 1,
                    parameterTypes: ["string"],
                    returnType: "void",
                },
                provenance: {
                    sourceFile: "entry/src/main/ets/pages/IdentityLongtail.ets",
                    enclosingMethodSignature: "@entry/src/main/ets/pages/IdentityLongtail.ets: Page.loadCatalog()",
                    localName: "catalog",
                },
            }),
        }),
        "unresolved",
        "receiver_member_candidate_not_registered",
    );

    const decoratorCollisionRegistry = createCanonicalApiRegistry([stateDecorator, projectStateDecorator]);
    const decoratorCollision = new ApiOccurrenceResolver(decoratorCollisionRegistry).resolve(rawOccurrence("raw:decorator-state-collision", {
        kind: "decorator",
        ir: { memberName: "State", unknownSignature: true },
        decoratorEvidence: {
            decoratorName: "State",
            ownerKind: "field",
            ownerName: "message",
            sourceFile: "entry/src/main/ets/pages/IdentityLongtail.ets",
        },
    }));
    assert(decoratorCollision.status === "ambiguous", `project decorator name collision must not be accepted as official, got ${decoratorCollision.status}:${decoratorCollision.reason}`);
}

function testLedgerStatusCoverage(): void {
    const rawOccurrences: RawApiOccurrence[] = [
        rawOccurrence("ledger:accepted", {
            ir: { memberName: "request", argCount: 1, unknownSignature: true },
            importEvidence: importKey({}),
        }),
        rawOccurrence("ledger:rejected", {
            ir: { memberName: "request", argCount: 1, unknownSignature: true },
            importEvidence: importKey({
                scopeEvidence: {
                    sourceFile: "entry/src/main/ets/pages/IdentityLongtail.ets",
                    enclosingMethodSignature: "@entry/src/main/ets/pages/IdentityLongtail.ets: Page.build()",
                    shadowed: true,
                },
            }),
        }),
        rawOccurrence("ledger:ambiguous", {
            ir: { memberName: "error", argCount: 4, unknownSignature: true },
            importEvidence: importKey({
                moduleSpecifier: "@ohos.hilog",
                importKind: "namespace",
                importedName: "*",
                localBindingId: "import:hilog",
                localName: "hilog",
                memberChain: ["error"],
                argShape: {
                    arity: 4,
                    parameterTypes: ["number", "string", "string", "unknown"],
                    returnType: "void",
                },
            }),
        }),
        rawOccurrence("ledger:unresolved", {
            ir: { memberName: "missing", argCount: 1, unknownSignature: true },
            importEvidence: importKey({
                moduleSpecifier: "@ohos.net.http",
                importedName: "missing",
                localBindingId: "import:missing",
                localName: "missing",
                memberChain: ["missing"],
            }),
        }),
    ];

    const resolved = rawOccurrences.map(raw => resolver.resolve(raw));
    assert(resolved.length === rawOccurrences.length, "every raw occurrence must produce a resolved ledger record");
    const byRaw = new Map(resolved.map(record => [record.rawOccurrenceId, record]));
    for (const raw of rawOccurrences) {
        const record = byRaw.get(raw.rawOccurrenceId);
        assert(record, `missing ledger record for ${raw.rawOccurrenceId}`);
        assert(record.reason && record.reason.length > 0, `${raw.rawOccurrenceId} must have a reason`);
        if (record.status === "accepted") {
            assert(record.canonicalApiId, `${raw.rawOccurrenceId} accepted record must carry canonicalApiId`);
        } else {
            assert(!record.canonicalApiId, `${raw.rawOccurrenceId} non-accepted record must not carry canonicalApiId`);
        }
    }
    assert(byRaw.get("ledger:accepted")?.status === "accepted", "ledger accepted status missing");
    assert(byRaw.get("ledger:rejected")?.status === "rejected", "ledger rejected status missing");
    assert(byRaw.get("ledger:ambiguous")?.status === "ambiguous", "ledger ambiguous status missing");
    assert(byRaw.get("ledger:unresolved")?.status === "unresolved", "ledger unresolved status missing");

    const records = buildOfficialOccurrenceRecords({
        rawOccurrences,
        resolvedOccurrences: resolved,
        canonicalApiRegistry: registry,
    });
    assert(records.length === rawOccurrences.length, "official occurrence ledger must retain accepted and non-accepted long-tail records");
    const recordsByRaw = new Map(records.map(record => [record.rawOccurrenceId, record]));
    for (const raw of rawOccurrences) {
        const record = recordsByRaw.get(raw.rawOccurrenceId);
        assert(record, `missing official occurrence record for ${raw.rawOccurrenceId}`);
        assert(record.reasonCode && record.reasonCode.length > 0, `${raw.rawOccurrenceId} ledger record must carry reasonCode`);
        assert(record.officialBasis.length > 0, `${raw.rawOccurrenceId} ledger record must carry official basis`);
        assert(record.evidenceGraph.rawOccurrenceId === raw.rawOccurrenceId, `${raw.rawOccurrenceId} evidence graph must retain rawOccurrenceId`);
        assert(record.evidenceGraph.reasonCode === record.reasonCode, `${raw.rawOccurrenceId} evidence graph must retain reasonCode`);
        if (record.status === "accepted") {
            assert(record.canonicalApiId, `${raw.rawOccurrenceId} accepted ledger record must carry canonicalApiId`);
            assert(record.evidenceGraph.canonicalApiId === record.canonicalApiId, `${raw.rawOccurrenceId} accepted graph must carry canonicalApiId`);
        } else {
            assert(!record.canonicalApiId, `${raw.rawOccurrenceId} non-accepted ledger record must not carry canonicalApiId`);
            assert(!record.evidenceGraph.canonicalApiId, `${raw.rawOccurrenceId} non-accepted graph must not carry canonicalApiId`);
        }
    }

    const effectEligible = resolved.filter(record => record.status === "accepted" && record.canonicalApiId);
    assert(effectEligible.length === 1, "only accepted occurrences may be eligible for effect-site binding");
}

function main(): void {
    testImportBinding();
    testFactoryReturnReceiver();
    testShapeDisambiguation();
    testArkUiDecoratorAndProperty();
    testLedgerStatusCoverage();
    console.log("official_identity_longtail_focused_ok");
}

main();
