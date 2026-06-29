import {
    type AssetDocumentBase,
    type AssetEndpoint,
    validateAssetDocument,
} from "../../core/assets/schema";
import type { CanonicalApiDescriptor } from "../../core/api/identity/CanonicalApiDescriptor";
import { canonicalApiIdFromTestDeclaration, indexedTestParameters } from "../helpers/CanonicalApiTestDeclarations";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function descriptor(args: {
    name: string;
    parameters: Array<{ index: number; type: string; rest?: boolean; optional?: boolean }>;
    returnType: string;
    invokeKind?: CanonicalApiDescriptor["invoke"]["kind"];
    memberKind?: CanonicalApiDescriptor["member"]["kind"];
    staticMember?: boolean;
    domain?: CanonicalApiDescriptor["domain"];
}): CanonicalApiDescriptor {
    const parameters = args.parameters.map(parameter => ({
        index: parameter.index,
        name: `arg${parameter.index}`,
        type: { text: parameter.type },
        rest: parameter.rest,
        optional: parameter.optional,
    }));
    const declaration = {
        authority: "official" as const,
        domain: args.domain || "openharmony" as const,
        moduleSpecifier: args.domain === "arkui" ? "@ohos.arkui" : "@ohos.c3",
        logicalDeclarationFile: args.domain === "arkui" ? "api/arkui.d.ts" : "api/c3.d.ts",
        exportPath: [{ kind: "namespace" as const, name: "C3" }],
        declarationOwner: {
            kind: "class" as const,
            path: ["C3"],
            normalizedName: "C3",
        },
        member: {
            kind: args.memberKind || "method" as const,
            name: args.name,
            static: args.staticMember === true,
        },
        invoke: { kind: args.invokeKind || "call" as const },
        signature: {
            parameters: parameters.map(parameter => ({
                index: parameter.index,
                name: parameter.name,
                type: parameter.type,
                optional: parameter.optional,
                rest: parameter.rest,
            })),
            returnType: { text: args.returnType },
        },
        arkanalyzer: {
            declaringFileName: "api/c3.d.ts",
            declaringNamespacePath: [],
            declaringClassName: "C3",
            methodName: args.name,
            parameterTypes: parameters.map(parameter => parameter.type.text),
            returnType: args.returnType,
            staticFlag: args.staticMember === true,
        },
        provenance: {
            source: "official-declaration" as const,
            declarationLocations: [{ file: "api/c3.d.ts", line: 1 }],
        },
    };
    const canonicalApiId = canonicalApiIdFromTestDeclaration({
        ...declaration,
        signature: {
            parameters: indexedTestParameters(parameters.map(parameter =>
                `${parameter.rest ? "..." : ""}${parameter.type.text}`,
            )),
            returnType: { text: args.returnType },
        },
    });
    return {
        ...declaration,
        canonicalApiId,
    };
}

function assetFor(
    api: CanonicalApiDescriptor,
    endpoint: AssetEndpoint,
    options: {
        plane?: AssetDocumentBase["plane"];
        role?: AssetDocumentBase["bindings"][number]["role"];
        templateKind?: string;
        templatePatch?: Record<string, unknown>;
    } = {},
): AssetDocumentBase {
    const plane = options.plane || "rule";
    const role = options.role || "source";
    const templateKind = options.templateKind || "rule.source";
    const template: Record<string, unknown> = {
        id: "template.c3",
        kind: templateKind,
        confidence: "certain",
    };
    if (templateKind === "rule.source") {
        template.sourceKind = "call_arg";
        template.value = endpoint;
    } else if (templateKind === "rule.sink") {
        template.sinkKind = "c3";
        template.value = endpoint;
    } else if (templateKind === "rule.transfer") {
        template.from = endpoint;
        template.to = { base: { kind: "return" } };
    } else if (templateKind === "handoff.put") {
        template.handle = {
            cellKind: "keyed-semantic-slot",
            family: "c3.module",
            key: [{ kind: "fromEndpoint", endpoint }],
            precision: "exact",
        };
        template.value = { base: { kind: "arg", index: 1 } };
        template.updateStrength = "strong";
    }
    Object.assign(template, options.templatePatch || {});
    return {
        id: "asset.c3",
        plane,
        status: "official",
        surfaces: [
            {
                surfaceId: "surface.c3",
                canonicalApiId: api.canonicalApiId,
                kind: api.invoke.kind === "new" ? "construct" : "invoke",
                confidence: "certain",
                provenance: { source: "sdk" },
            } as any,
        ],
        bindings: [
            {
                bindingId: "binding.c3",
                surfaceId: "surface.c3",
                assetId: "asset.c3",
                canonicalApiId: api.canonicalApiId,
                plane,
                role,
                endpoint,
                effectTemplateRefs: ["template.c3"],
                semanticsFamily: "c3",
                completeness: "complete",
                confidence: "certain",
            } as any,
        ],
        effectTemplates: [template as any],
        provenance: { source: "manual" },
    };
}

function expectValid(asset: AssetDocumentBase, api: CanonicalApiDescriptor, name: string): void {
    const validation = validateAssetDocument(asset, { canonicalApiDescriptors: [api] });
    assert(validation.valid, `${name} should be valid: ${validation.errors.join("; ")}`);
}

function expectInvalid(asset: AssetDocumentBase, api: CanonicalApiDescriptor, messagePart: string, name: string): void {
    const validation = validateAssetDocument(asset, { canonicalApiDescriptors: [api] });
    assert(!validation.valid, `${name} should be invalid`);
    assert(
        validation.errors.some(error => error.includes(messagePart)),
        `${name} should include ${messagePart}, got: ${validation.errors.join("; ")}`,
    );
}

function main(): void {
    const restApi = descriptor({
        name: "log",
        parameters: [
            { index: 0, type: "number" },
            { index: 1, type: "string" },
            { index: 2, type: "Object[]", rest: true },
        ],
        returnType: "void",
        staticMember: true,
    });
    expectValid(assetFor(restApi, { base: { kind: "arg", index: 2 } }), restApi, "canonical rest arg endpoint");
    expectInvalid(assetFor(restApi, { base: { kind: "arg", index: 3 } }), restApi, "arg_out_of_range", "arg out of range");

    const promiseApi = descriptor({
        name: "request",
        parameters: [{ index: 0, type: "RequestOptions" }],
        returnType: "Promise<Response>",
        staticMember: true,
    });
    expectValid(assetFor(promiseApi, { base: { kind: "promiseResult" } }), promiseApi, "promise result endpoint");
    expectValid(assetFor(promiseApi, { base: { kind: "promiseRejected" } }), promiseApi, "promise rejected endpoint");

    const syncApi = descriptor({
        name: "sync",
        parameters: [{ index: 0, type: "string" }],
        returnType: "string",
        staticMember: true,
    });
    expectInvalid(assetFor(syncApi, { base: { kind: "promiseResult" } }), syncApi, "promise_result_not_projectable", "promise result on sync API");
    expectInvalid(assetFor(syncApi, { base: { kind: "promiseRejected" } }), syncApi, "promise_rejected_not_projectable", "promise rejected on sync API");

    const voidApi = descriptor({
        name: "voidCall",
        parameters: [],
        returnType: "void",
        staticMember: true,
    });
    expectInvalid(assetFor(voidApi, { base: { kind: "return" } }), voidApi, "return_not_projectable", "return on void API");

    const constructorApi = descriptor({
        name: "constructor",
        parameters: [{ index: 0, type: "Options" }],
        returnType: "C3",
        invokeKind: "new",
        memberKind: "constructor",
    });
    expectValid(assetFor(constructorApi, { base: { kind: "constructorResult" } }), constructorApi, "constructor result endpoint");
    expectInvalid(assetFor(syncApi, { base: { kind: "constructorResult" } }), syncApi, "constructor_result_not_projectable", "constructorResult on call API");
    expectInvalid(assetFor(constructorApi, { base: { kind: "receiver" } }), constructorApi, "receiver_not_projectable", "receiver on construct API");

    const callbackApi = descriptor({
        name: "on",
        parameters: [{ index: 0, type: "Options" }],
        returnType: "void",
    });
    expectValid(
        assetFor(callbackApi, {
            base: {
                kind: "callbackArg",
                callback: { kind: "option", base: { base: { kind: "arg", index: 0 } }, accessPath: ["onReady"] },
                argIndex: 0,
            },
        }),
        callbackApi,
        "option callbackArg endpoint",
    );
    expectInvalid(
        assetFor(callbackApi, {
            base: {
                kind: "callbackArg",
                callback: { kind: "arg", index: 2 },
                argIndex: 0,
            },
        }),
        callbackApi,
        "arg_out_of_range",
        "callback locator arg out of range",
    );

    const moduleApi = descriptor({
        name: "put",
        parameters: [
            { index: 0, type: "string" },
            { index: 1, type: "Object" },
        ],
        returnType: "void",
    });
    expectValid(
        assetFor(moduleApi, { base: { kind: "arg", index: 0 }, accessPath: ["id"] }, {
            plane: "module",
            role: "handoff",
            templateKind: "handoff.put",
        }),
        moduleApi,
        "module carrier endpoint",
    );
    expectInvalid(
        assetFor(moduleApi, { base: { kind: "arg", index: 0 } }, {
            plane: "module",
            role: "handoff",
            templateKind: "handoff.put",
            templatePatch: {
                handle: {
                    cellKind: "keyed-semantic-slot",
                    family: "c3.module",
                    key: [{ kind: "fromLiteralArg", index: 3 }],
                    precision: "exact",
                },
                value: { base: { kind: "arg", index: 1 } },
                updateStrength: "strong",
            },
        }),
        moduleApi,
        "arg_out_of_range",
        "module handle literal arg out of range",
    );

    const arkuiApi = descriptor({
        name: "Image",
        parameters: [{ index: 0, type: "ResourceStr" }],
        returnType: "void",
        invokeKind: "component-chain",
        memberKind: "component-event",
        domain: "arkui",
    });
    expectValid(assetFor(arkuiApi, { base: { kind: "arg", index: 0 } }), arkuiApi, "ArkUI resource arg endpoint");

    console.log("PASS test_endpoint_schema_projectability");
}

main();
