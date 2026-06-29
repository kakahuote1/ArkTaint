import * as fs from "fs";
import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import type {
    ModuleSemanticSurfaceRef,
    InternalModuleLoweringIR,
} from "../../core/kernel/contracts/InternalModuleLoweringIR";
import type { AssetDocumentBase, AssetSurface } from "../../core/assets/schema";
import { fromProjectDeclaration } from "../../core/api/identity";
import type { TaintModule } from "../../core/kernel/contracts/ModuleContract";
import { compileInternalModuleLoweringIR } from "../../core/orchestration/modules/InternalModuleLoweringIRCompiler";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { loadRuleSet, type LoadedRuleSet } from "../../core/rules/RuleLoader";
import { findCaseMethod, resolveCaseMethod } from "../helpers/SyntheticCaseHarness";
import { resolveTestRunDir, resolveTestRunPath } from "../helpers/TestWorkspaceLayout";
import { bindExactAssetIdentities } from "../helpers/AssetIdentityTestUtils";
import harmonyStateModuleAsset from "../../models/kernel/modules/harmony/state";
import harmonyAppStorageModuleAsset from "../../models/kernel/modules/harmony/appstorage";
import tsjsContainerModuleAsset from "../../models/kernel/modules/tsjs/container";
import {
    buildProjectDeclarationRegistry,
    parseCanonicalApiId,
    toCanonicalApiRegistrySnapshot,
    writeCanonicalApiRegistrySnapshot,
    type CanonicalApiDeclarationEvidence,
} from "../../core/api/identity";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function progress(message: string): void {
    if (process.env.ARKTAINT_TEST_PROGRESS === "1") {
        console.log(`[internal_module_lowering] ${message}`);
    }
}

let cachedFixtureRuleSet: LoadedRuleSet | undefined;

function writeText(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf-8");
}

function capabilityPayload(asset: AssetDocumentBase): Record<string, any> {
    const template = (asset.effectTemplates || []).find(item => item.kind === "core.capability") as any;
    if (!template || typeof template.payload !== "object" || template.payload === null) {
        throw new Error(`module asset ${asset.id} must expose a core.capability payload for this fixture`);
    }
    return template.payload as Record<string, any>;
}

type FixtureInvokeSurface = Extract<AssetSurface, { kind: "invoke" }>;

interface FixtureProjectClassMethodInput {
    modulePath: string;
    className: string;
    methodName: string;
    parameterTypes: string[];
    returnType: string;
    staticMember?: boolean;
}

function projectClassMethodCanonicalApiId(input: FixtureProjectClassMethodInput): string {
    const result = fromProjectDeclaration(projectClassMethodDeclaration(input));
    if (result.status !== "accepted") {
        throw new Error(`fixture project method identity rejected for ${input.className}.${input.methodName}: ${result.reason}`);
    }
    return result.descriptor.canonicalApiId;
}

function projectClassMethodDeclaration(input: FixtureProjectClassMethodInput): CanonicalApiDeclarationEvidence {
    const file = syntheticFixtureDeclarationFile(input.modulePath);
    return {
        domain: "local",
        moduleSpecifier: input.modulePath,
        logicalDeclarationFile: file,
        exportPath: [{ kind: "namespace", name: input.className }],
        declarationOwner: {
            kind: "class",
            path: [input.className],
            normalizedName: input.className,
            arkanalyzerName: input.className,
        },
        member: { kind: "method", name: input.methodName, static: !!input.staticMember },
        invoke: { kind: "call" },
        signature: {
            parameters: input.parameterTypes.map((type, index) => ({ index, type: { text: type } })),
            returnType: { text: input.returnType },
        },
        arkanalyzer: {
            declaringFileName: input.modulePath,
            declaringNamespacePath: [],
            declaringClassName: input.className,
            methodName: input.methodName,
            parameterTypes: input.parameterTypes,
            returnType: input.returnType,
            staticFlag: !!input.staticMember,
        },
        declarationLocations: [{ file }],
    };
}

function projectClassMethodSurface(
    surfaceId: string,
    input: FixtureProjectClassMethodInput,
): FixtureInvokeSurface {
    return {
        surfaceId,
        kind: "invoke",
        canonicalApiId: projectClassMethodCanonicalApiId(input),
        evidence: {
            arkanalyzer: {
                methodKey: {
                    declaringFileName: input.modulePath,
                    declaringNamespacePath: [],
                    declaringClassName: input.className,
                    methodName: input.methodName,
                    parameterTypes: input.parameterTypes,
                    returnType: input.returnType,
                    staticFlag: !!input.staticMember,
                },
            },
        },
        confidence: "certain",
        provenance: { source: "manual" },
    };
}

interface FixtureProjectFreeFunctionInput {
    modulePath: string;
    functionName: string;
    parameterTypes: string[];
    returnType: string;
}

function projectFreeFunctionCanonicalApiId(input: FixtureProjectFreeFunctionInput): string {
    const result = fromProjectDeclaration(projectFreeFunctionDeclaration(input));
    if (result.status !== "accepted") {
        throw new Error(`fixture project function identity rejected for ${input.functionName}: ${result.reason}`);
    }
    return result.descriptor.canonicalApiId;
}

function projectFreeFunctionDeclaration(input: FixtureProjectFreeFunctionInput): CanonicalApiDeclarationEvidence {
    const file = syntheticFixtureDeclarationFile(input.modulePath);
    return {
        domain: "local",
        moduleSpecifier: input.modulePath,
        logicalDeclarationFile: file,
        exportPath: [{ kind: "default", name: "file" }],
        declarationOwner: {
            kind: "namespace",
            path: ["file"],
            normalizedName: "file",
            arkanalyzerName: "file",
        },
        member: { kind: "function", name: input.functionName },
        invoke: { kind: "call" },
        signature: {
            parameters: input.parameterTypes.map((type, index) => ({ index, type: { text: type } })),
            returnType: { text: input.returnType },
        },
        arkanalyzer: {
            declaringFileName: input.modulePath,
            declaringNamespacePath: [],
            declaringClassName: "%dflt",
            methodName: input.functionName,
            parameterTypes: input.parameterTypes,
            returnType: input.returnType,
            staticFlag: true,
        },
        declarationLocations: [{ file }],
    };
}

function projectFreeFunctionSurface(
    surfaceId: string,
    input: FixtureProjectFreeFunctionInput,
): FixtureInvokeSurface {
    return {
        surfaceId,
        kind: "invoke",
        canonicalApiId: projectFreeFunctionCanonicalApiId(input),
        evidence: {
            arkanalyzer: {
                methodKey: {
                    declaringFileName: input.modulePath,
                    declaringNamespacePath: [],
                    declaringClassName: "%dflt",
                    methodName: input.functionName,
                    parameterTypes: input.parameterTypes,
                    returnType: input.returnType,
                    staticFlag: true,
                },
            },
        },
        confidence: "certain",
        provenance: { source: "manual" },
    };
}

function syntheticFixtureDeclarationFile(modulePath: string): string {
    const safe = String(modulePath || "test-fixture")
        .replace(/^@/, "")
        .replace(/[^A-Za-z0-9_.-]+/g, "_")
        .replace(/^_+|_+$/g, "") || "test_fixture";
    return `tests/api/${safe}.d.ts`;
}

function eventEmitterProjectApiIds(): { on: string[]; emit: string[] } {
    const eventBus = eventBusMethodInputs();
    return {
        on: eventBus.filter(input => input.methodName === "on").map(projectClassMethodCanonicalApiId),
        emit: eventBus.filter(input => input.methodName === "emit").map(projectClassMethodCanonicalApiId),
    };
}

function routerProjectApiIds(): { pushRouteWrapped: string; getRouteParams: string } {
    const methods = routerMethodInputs();
    const pushRouteWrapped = methods.find(input => input.methodName === "pushRouteWrapped");
    const getRouteParams = methods.find(input => input.methodName === "getRouteParams");
    assert(!!pushRouteWrapped && !!getRouteParams, "router fixture method identities are incomplete");
    return {
        pushRouteWrapped: projectClassMethodCanonicalApiId(pushRouteWrapped),
        getRouteParams: projectClassMethodCanonicalApiId(getRouteParams),
    };
}

function keyedStorageProjectApiIds(): { putValue: string[] } {
    return {
        putValue: storageMethodInputs().map(projectClassMethodCanonicalApiId),
    };
}

function eventBusMethodInputs(): FixtureProjectClassMethodInput[] {
    return [
        {
            modulePath: "repo/src/main/ets/emitter_case.ets",
            className: "EventBus",
            methodName: "on",
            parameterTypes: ["string", "@repo/src/main/ets/emitter_case.ets: EventBus.%AM0(string)"],
            returnType: "void",
        },
        {
            modulePath: "repo/src/main/ets/emitter_case.ets",
            className: "EventBus",
            methodName: "emit",
            parameterTypes: ["string", "string"],
            returnType: "void",
        },
        {
            modulePath: "repo/src/main/ets/emitter_scope_case.ets",
            className: "EventBusA",
            methodName: "on",
            parameterTypes: ["string", "@repo/src/main/ets/emitter_scope_case.ets: EventBusA.%AM0(string)"],
            returnType: "void",
        },
        {
            modulePath: "repo/src/main/ets/emitter_scope_case.ets",
            className: "EventBusA",
            methodName: "emit",
            parameterTypes: ["string", "string"],
            returnType: "void",
        },
        {
            modulePath: "repo/src/main/ets/emitter_scope_case.ets",
            className: "EventBusB",
            methodName: "on",
            parameterTypes: ["string", "@repo/src/main/ets/emitter_scope_case.ets: EventBusB.%AM0(string)"],
            returnType: "void",
        },
        {
            modulePath: "repo/src/main/ets/emitter_scope_case.ets",
            className: "EventBusB",
            methodName: "emit",
            parameterTypes: ["string", "string"],
            returnType: "void",
        },
    ];
}

function routerMethodInputs(): FixtureProjectClassMethodInput[] {
    return [
        {
            modulePath: "repo/src/main/ets/router_unwrap_case.ets",
            className: "RouterLike",
            methodName: "pushRouteWrapped",
            parameterTypes: ["@repo/src/main/ets/router_unwrap_case.ets: RoutePushOptions"],
            returnType: "void",
            staticMember: true,
        },
        {
            modulePath: "repo/src/main/ets/router_unwrap_case.ets",
            className: "RouterLike",
            methodName: "getRouteParams",
            parameterTypes: [],
            returnType: "@repo/src/main/ets/router_unwrap_case.ets: RouteResultParams",
            staticMember: true,
        },
    ];
}

function storageMethodInputs(): FixtureProjectClassMethodInput[] {
    return [
        {
            modulePath: "repo/src/main/ets/storage_prop_case.ets",
            className: "StorageHubProp",
            methodName: "putValue",
            parameterTypes: ["string", "string"],
            returnType: "void",
            staticMember: true,
        },
        {
            modulePath: "repo/src/main/ets/storage_prop_mismatch_case.ets",
            className: "StorageHubPropMismatch",
            methodName: "putValue",
            parameterTypes: ["string", "string"],
            returnType: "void",
            staticMember: true,
        },
    ];
}

function bridgeClassMethodInputs(): FixtureProjectClassMethodInput[] {
    return [
        {
            modulePath: "repo/src/main/ets/carrier_case.ets",
            className: "Bus",
            methodName: "onMessage",
            parameterTypes: ["@repo/src/main/ets/carrier_case.ets: Bus.%AM0(string)"],
            returnType: "void",
        },
        {
            modulePath: "repo/src/main/ets/carrier_case.ets",
            className: "Bus",
            methodName: "postMessage",
            parameterTypes: ["string"],
            returnType: "void",
        },
        {
            modulePath: "repo/src/main/ets/method_field_state_case.ets",
            className: "Lifecycle020",
            methodName: "onCreate",
            parameterTypes: ["string"],
            returnType: "void",
        },
        {
            modulePath: "repo/src/main/ets/method_field_state_case.ets",
            className: "Lifecycle020",
            methodName: "render",
            parameterTypes: [],
            returnType: "void",
        },
        {
            modulePath: "repo/src/main/ets/declarative_case.ets",
            className: "WatchBox",
            methodName: "setToken",
            parameterTypes: ["string"],
            returnType: "void",
        },
        {
            modulePath: "repo/src/main/ets/declarative_case.ets",
            className: "WatchBox",
            methodName: "onTokenChanged",
            parameterTypes: [],
            returnType: "void",
        },
        {
            modulePath: "repo/src/main/ets/method_param_case.ets",
            className: "AbilityContext",
            methodName: "startAbility",
            parameterTypes: ["string"],
            returnType: "void",
        },
        {
            modulePath: "repo/src/main/ets/method_param_case.ets",
            className: "DemoAbility",
            methodName: "onCreate",
            parameterTypes: ["string"],
            returnType: "void",
        },
    ];
}

function bridgeFreeFunctionInputs(): FixtureProjectFreeFunctionInput[] {
    return [
        {
            modulePath: "repo/src/main/ets/callback_case.ets",
            functionName: "Register",
            parameterTypes: ["string", "@repo/src/main/ets/callback_case.ets: %dflt.%AM0(string)"],
            returnType: "void",
        },
        {
            modulePath: "repo/src/main/ets/keyed_state_case.ets",
            functionName: "Put",
            parameterTypes: ["string", "string"],
            returnType: "void",
        },
        {
            modulePath: "repo/src/main/ets/keyed_state_case.ets",
            functionName: "Get",
            parameterTypes: ["string"],
            returnType: "string",
        },
        {
            modulePath: "repo/src/main/ets/same_address_case.ets",
            functionName: "PutAddress",
            parameterTypes: ["string", "string"],
            returnType: "void",
        },
        {
            modulePath: "repo/src/main/ets/same_address_case.ets",
            functionName: "GetAddress",
            parameterTypes: ["string"],
            returnType: "string",
        },
        {
            modulePath: "repo/src/main/ets/stringify_boundary_case.ets",
            functionName: "JsonStringify013",
            parameterTypes: ["@repo/src/main/ets/stringify_boundary_case.ets: StringifyPayload013"],
            returnType: "string",
        },
        {
            modulePath: "repo/src/main/ets/clone_copy_boundary_case.ets",
            functionName: "SaveClone014",
            parameterTypes: ["@repo/src/main/ets/clone_copy_boundary_case.ets: CloneSource014"],
            returnType: "void",
        },
        {
            modulePath: "repo/src/main/ets/clone_copy_boundary_case.ets",
            functionName: "LoadClone014",
            parameterTypes: [],
            returnType: "@repo/src/main/ets/clone_copy_boundary_case.ets: CloneTarget014",
        },
    ];
}

function projectSemanticSurfaces(fixtureId: string): FixtureInvokeSurface[] {
    const classSurfaces = [
        ...eventBusMethodInputs(),
        ...routerMethodInputs(),
        ...storageMethodInputs(),
        ...bridgeClassMethodInputs(),
    ].map((input, index) => projectClassMethodSurface(
        `surface.${fixtureId}.semantic.project_api.class.${index}.${input.className}.${input.methodName}`,
        input,
    ));
    const freeFunctionSurfaces = bridgeFreeFunctionInputs().map((input, index) => projectFreeFunctionSurface(
        `surface.${fixtureId}.semantic.project_api.function.${index}.${input.functionName}`,
        input,
    ));
    return [...classSurfaces, ...freeFunctionSurfaces];
}

function writeFixtureRuleAsset(filePath: string, fixtureId: string): void {
    const files = [
        "callback_case.ets",
        "carrier_case.ets",
        "emitter_scope_case.ets",
        "keyed_state_case.ets",
        "same_address_case.ets",
        "method_field_state_case.ets",
        "declarative_case.ets",
        "method_param_case.ets",
        "emitter_case.ets",
        "router_unwrap_case.ets",
        "storage_prop_case.ets",
        "storage_prop_mismatch_case.ets",
        "provide_consume_case.ets",
        "container_map_case.ets",
        "stringify_boundary_case.ets",
        "clone_copy_boundary_case.ets",
    ];
    const ruleSurfaces = files.flatMap((name, index) => {
        const prefix = `surface.${fixtureId}.${index}`;
        const modulePath = `repo/src/main/ets/${name}`;
        return [
            projectFreeFunctionSurface(`${prefix}.Source`, {
                modulePath,
                functionName: "Source",
                parameterTypes: [],
                returnType: "string",
            }),
            projectFreeFunctionSurface(`${prefix}.Sink`, {
                modulePath,
                functionName: "Sink",
                parameterTypes: ["string"],
                returnType: "void",
            }),
        ];
    });
    const surfaces = [...ruleSurfaces, ...projectSemanticSurfaces(fixtureId)];
    const bindings = files.flatMap((_name, index) => {
        const prefix = `${fixtureId}.${index}`;
        return [
            {
                bindingId: `binding.${prefix}.Source.return`,
                surfaceId: `surface.${prefix}.Source`,
                assetId: `asset.rule.${fixtureId}`,
                plane: "rule",
                role: "source",
                endpoint: { base: { kind: "return" } },
                effectTemplateRefs: [`template.${prefix}.Source.return`],
                completeness: "complete",
                confidence: "certain",
            },
            {
                bindingId: `binding.${prefix}.Sink.arg0`,
                surfaceId: `surface.${prefix}.Sink`,
                assetId: `asset.rule.${fixtureId}`,
                plane: "rule",
                role: "sink",
                endpoint: { base: { kind: "arg", index: 0 } },
                effectTemplateRefs: [`template.${prefix}.Sink.arg0`],
                completeness: "complete",
                confidence: "certain",
            },
        ];
    });
    const effectTemplates = files.flatMap((_name, index) => {
        const prefix = `${fixtureId}.${index}`;
        return [
            {
                id: `template.${prefix}.Source.return`,
                kind: "rule.source",
                sourceKind: "call_return",
                value: { base: { kind: "return" } },
                confidence: "certain",
            },
            {
                id: `template.${prefix}.Sink.arg0`,
                kind: "rule.sink",
                sinkKind: "fixture",
                value: { base: { kind: "arg", index: 0 } },
                confidence: "certain",
            },
        ];
    });
    const asset = bindExactAssetIdentities({
        id: `asset.rule.${fixtureId}`,
        plane: "rule",
        status: "reviewed",
        surfaces,
        bindings,
        effectTemplates,
        provenance: {
            source: "manual",
            evidenceLocations: [{ file: filePath }],
        },
    } as AssetDocumentBase);
    writeText(filePath, JSON.stringify(asset, null, 2));
}

function writeFixtureCanonicalRegistry(filePath: string): void {
    const files = [
        "callback_case.ets",
        "carrier_case.ets",
        "emitter_scope_case.ets",
        "keyed_state_case.ets",
        "same_address_case.ets",
        "method_field_state_case.ets",
        "declarative_case.ets",
        "method_param_case.ets",
        "emitter_case.ets",
        "router_unwrap_case.ets",
        "storage_prop_case.ets",
        "storage_prop_mismatch_case.ets",
        "provide_consume_case.ets",
        "container_map_case.ets",
        "stringify_boundary_case.ets",
        "clone_copy_boundary_case.ets",
    ];
    const declarations: CanonicalApiDeclarationEvidence[] = [];
    for (const name of files) {
        const modulePath = `repo/src/main/ets/${name}`;
        declarations.push(
            projectFreeFunctionDeclaration({
                modulePath,
                functionName: "Source",
                parameterTypes: [],
                returnType: "string",
            }),
            projectFreeFunctionDeclaration({
                modulePath,
                functionName: "Sink",
                parameterTypes: ["string"],
                returnType: "void",
            }),
        );
    }
    declarations.push(
        ...[
            ...eventBusMethodInputs(),
            ...routerMethodInputs(),
            ...storageMethodInputs(),
            ...bridgeClassMethodInputs(),
        ].map(projectClassMethodDeclaration),
        ...bridgeFreeFunctionInputs().map(projectFreeFunctionDeclaration),
    );
    const result = buildProjectDeclarationRegistry(declarations);
    if (!result.ok) {
        throw new Error(`fixture canonical registry should be valid: ${result.diagnostics.map(item => item.message).join("; ")}`);
    }
    writeCanonicalApiRegistrySnapshot(filePath, toCanonicalApiRegistrySnapshot(result));
}

function moduleIdentityAssetForSpec(spec: InternalModuleLoweringIR, fixtureId: string): AssetDocumentBase {
    const canonicalApiIds = collectCanonicalApiIds(spec);
    const projectSurfacesByCanonicalApiId = new Map(
        projectSemanticSurfaces(fixtureId).map(surface => [surface.canonicalApiId, surface]),
    );
    const assetId = `asset.module.${assetIdSegment(spec.id)}`;
    const surfaces = canonicalApiIds.map((canonicalApiId, index): AssetSurface => {
        const projectSurface = projectSurfacesByCanonicalApiId.get(canonicalApiId);
        if (projectSurface) {
            return {
                ...projectSurface,
                surfaceId: `surface.${assetIdSegment(spec.id)}.${String(index + 1).padStart(4, "0")}`,
            };
        }
        const parsed = parseCanonicalApiId(canonicalApiId);
        assert(!!parsed, `module fixture spec ${spec.id} references invalid canonicalApiId: ${canonicalApiId}`);
        const kind = parsed.invoke === "decorator"
            ? "decorator"
            : parsed.invoke === "new"
                ? "construct"
                : "invoke";
        return {
            surfaceId: `surface.${assetIdSegment(spec.id)}.${String(index + 1).padStart(4, "0")}`,
            kind,
            canonicalApiId,
            confidence: "certain",
            provenance: {
                source: parsed.authority === "official" ? "sdk" : parsed.authority === "project" ? "project" : "manual",
            },
        } as AssetSurface;
    });
    const templateId = `template.${assetIdSegment(spec.id)}.identity_gate`;
    const endpointBindings = collectModuleEndpointBindings(spec, surfaces, assetId, templateId);
    const surfacesWithoutEndpointBindings = surfaces.filter(surface =>
        !endpointBindings.some(binding => binding.surfaceId === surface.surfaceId),
    );
    return bindExactAssetIdentities({
        id: assetId,
        plane: "module",
        status: "reviewed",
        surfaces,
        bindings: [
            ...endpointBindings,
            ...surfacesWithoutEndpointBindings.map((surface, index) => ({
            bindingId: `binding.${assetIdSegment(spec.id)}.${String(index + 1).padStart(4, "0")}`,
            surfaceId: surface.surfaceId,
            canonicalApiId: surface.canonicalApiId,
            assetId,
            plane: "module",
            role: "module",
            effectTemplateRefs: [templateId],
            semanticsFamily: spec.id,
            completeness: "complete",
            confidence: "certain",
            })),
        ],
        effectTemplates: [
            {
                id: templateId,
                kind: "core.capability",
                capability: "module.explicit-ir",
                payload: {
                    specId: spec.id,
                    canonicalApiIds,
                },
                confidence: "certain",
            },
        ],
        provenance: {
            source: "manual",
        },
    } as AssetDocumentBase);
}

function collectModuleEndpointBindings(
    spec: InternalModuleLoweringIR,
    surfaces: AssetSurface[],
    assetId: string,
    templateId: string,
): any[] {
    const surfaceByCanonicalApiId = new Map(surfaces.map(surface => [surface.canonicalApiId, surface]));
    const bindings: any[] = [];
    const seen = new Set<string>();
    const visit = (item: unknown): void => {
        if (Array.isArray(item)) {
            for (const child of item) visit(child);
            return;
        }
        if (!item || typeof item !== "object") return;
        const endpoint = item as Record<string, unknown>;
        const assetEndpoint = assetEndpointFromModuleEndpoint(endpoint);
        const surfaceRef = endpoint.surface as any;
        const canonicalApiId = surfaceRef?.kind === "invoke"
            ? String(surfaceRef.selector?.canonicalApiId || "")
            : "";
        const surface = canonicalApiId ? surfaceByCanonicalApiId.get(canonicalApiId) : undefined;
        if (surface && assetEndpoint) {
            const key = `${surface.surfaceId}|${JSON.stringify(assetEndpoint)}`;
            if (!seen.has(key)) {
                seen.add(key);
                bindings.push({
                    bindingId: `binding.${assetIdSegment(spec.id)}.endpoint.${String(bindings.length + 1).padStart(4, "0")}`,
                    surfaceId: surface.surfaceId,
                    canonicalApiId,
                    assetId,
                    plane: "module",
                    role: "module",
                    endpoint: assetEndpoint,
                    effectTemplateRefs: [templateId],
                    semanticsFamily: spec.id,
                    completeness: "complete",
                    confidence: "certain",
                });
            }
        }
        for (const child of Object.values(endpoint)) {
            visit(child);
        }
    };
    visit(spec);
    return bindings;
}

function assetEndpointFromModuleEndpoint(endpoint: Record<string, unknown>): any | undefined {
    switch (endpoint.slot) {
        case "arg":
            return { base: { kind: "arg", index: Number(endpoint.index) } };
        case "base":
            return { base: { kind: "receiver" } };
        case "result":
            return { base: { kind: "return" } };
        default:
            return undefined;
    }
}

function collectCanonicalApiIds(value: unknown): string[] {
    const out = new Set<string>();
    const visit = (item: unknown, key?: string): void => {
        if (typeof item === "string") {
            if (key === "canonicalApiId") {
                out.add(item);
            }
            return;
        }
        if (Array.isArray(item)) {
            for (const child of item) {
                if (typeof child === "string" && isCanonicalApiIdsField(key)) {
                    out.add(child);
                    continue;
                }
                visit(child, key);
            }
            return;
        }
        if (!item || typeof item !== "object") return;
        for (const [childKey, childValue] of Object.entries(item as Record<string, unknown>)) {
            visit(childValue, childKey);
        }
    };
    visit(value);
    return [...out.values()].sort((left, right) => left.localeCompare(right));
}

function isCanonicalApiIdsField(key: string | undefined): boolean {
    return key === "canonicalApiIds" || !!key?.endsWith("CanonicalApiIds");
}

function assetIdSegment(value: string): string {
    return String(value || "module")
        .replace(/[^A-Za-z0-9_.-]+/g, "_")
        .replace(/^_+|_+$/g, "") || "module";
}

function hasLoweredModule(loadedModuleIds: string[], specId: string): boolean {
    return loadedModuleIds.some(id => id === specId || id.startsWith(`${specId}::`));
}

function expectCompileError(spec: unknown, expectedSubstrings: string[]): void {
    let message = "";
    try {
        compileInternalModuleLoweringIR(spec as InternalModuleLoweringIR);
        assert(false, "expected compileInternalModuleLoweringIR to fail");
    } catch (error) {
        message = String((error as any)?.message || error);
    }
    for (const expected of expectedSubstrings) {
        assert(
            message.includes(expected),
            `expected compile error to include ${JSON.stringify(expected)}, got: ${message}`,
        );
    }
}

function modulesFromSpec(spec: InternalModuleLoweringIR): TaintModule[] {
    return compileInternalModuleLoweringIR(spec);
}

function moduleOptionsFromSpec(spec: InternalModuleLoweringIR): { modules: TaintModule[]; moduleAssets: AssetDocumentBase[] } {
    const canonicalApiIds = collectCanonicalApiIds(spec);
    return {
        modules: modulesFromSpec(spec),
        moduleAssets: canonicalApiIds.length > 0
            ? [moduleIdentityAssetForSpec(spec, "fixture.internal_module_lowering_ir")]
            : [],
    };
}

function buildScene(projectDir: string): Scene {
    const config = new SceneConfig();
    config.buildFromProjectDir(projectDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    return scene;
}

function loadFixtureRuleSet(): LoadedRuleSet {
    if (!cachedFixtureRuleSet) {
        cachedFixtureRuleSet = loadRuleSet({
            kernelRulePath: path.resolve("tests/rules/minimal.rules.json"),
            projectRulePath: path.resolve(resolveTestRunPath("runtime", "module_spec_engine", "fixtures", "project.rules.json")),
            canonicalApiRegistrySnapshotPath: path.resolve(resolveTestRunPath("runtime", "module_spec_engine", "fixtures", "canonical_api_registry.json")),
            allowMissingProject: false,
            autoDiscoverRuleSources: false,
        });
    }
    return cachedFixtureRuleSet;
}

async function runCase(
    scene: Scene,
    relativePath: string,
    caseName: string,
    options: {
        modules?: TaintModule[];
        moduleAssets?: AssetDocumentBase[];
    },
): Promise<{
    totalFlows: number;
    loadedModuleIds: string[];
    deferredContractCount: number;
    seedCount: number;
    sourceRuleHits: Record<string, number>;
    sourceRuleZeroHitAudit: unknown;
    moduleStats: Record<string, unknown>;
    sinkProfile: unknown;
    sinkAudit: unknown;
    entryIr: unknown;
}> {
    progress(`prepare ${caseName}`);
    const loaded = loadFixtureRuleSet();
    const apiAssets = options.moduleAssets?.length
        ? [...loaded.assets, ...options.moduleAssets]
        : loaded.assets;
    const sourceRules = loaded.ruleSet.sources || [];
    const sinkRules = loaded.ruleSet.sinks || [];
    const entry = resolveCaseMethod(scene, relativePath, caseName);
    const entryMethod = findCaseMethod(scene, entry);
    assert(!!entryMethod, `missing entry method: ${caseName}`);
    progress(`start ${caseName}`);

    const engine = new TaintPropagationEngine(scene, 1, {
        includeBuiltinModules: false,
        modules: options.modules,
        apiAssets,
        ...(options.moduleAssets?.length ? {} : { assetIdentityIndex: loaded.assetIdentityIndex }),
    });
    engine.verbose = false;
    progress(`buildPAG ${caseName}`);
    await engine.buildPAG({
        syntheticEntryMethods: [entryMethod!],
        entryModel: "explicit",
    });
    progress(`reachable ${caseName}`);
    try {
        const reachable = engine.computeReachableMethodSignatures();
        engine.setActiveReachableMethodSignatures(reachable);
    } catch {
        engine.setActiveReachableMethodSignatures(undefined);
    }

    progress(`propagate ${caseName}`);
    const seedInfo = engine.propagateWithSourceRules(sourceRules);
    progress(`detect ${caseName}`);
    const flows = engine.detectSinksByRules(sinkRules);
    progress(`audit ${caseName}`);
    const audit = engine.getModuleAuditSnapshot();
    const deferredCount = engine.getExecutionHandoffContractSnapshot()?.totalContracts || 0;
    progress(`done ${caseName} flows=${flows.length} seeds=${seedInfo.seedCount} deferred=${deferredCount}`);
    return {
        totalFlows: flows.length,
        loadedModuleIds: audit.loadedModuleIds,
        deferredContractCount: deferredCount,
        seedCount: seedInfo.seedCount,
        sourceRuleHits: seedInfo.sourceRuleHits,
        sourceRuleZeroHitAudit: seedInfo.sourceRuleZeroHitAudit,
        moduleStats: audit.moduleStats,
        sinkProfile: engine.getDetectProfile(),
        sinkAudit: engine.getSinkDetectionAuditSnapshot(),
        entryIr: describeMethodIr(entryMethod!),
    };
}

function formatRunCaseDebug(label: string, result: Awaited<ReturnType<typeof runCase>>): string {
    return [
        `${label}: flows=${result.totalFlows}`,
        `seedCount=${result.seedCount}`,
        `sourceRuleHits=${JSON.stringify(result.sourceRuleHits)}`,
        `sourceRuleZeroHitAudit=${JSON.stringify(result.sourceRuleZeroHitAudit)}`,
        `loadedModuleIds=${JSON.stringify(result.loadedModuleIds)}`,
        `deferredContractCount=${result.deferredContractCount}`,
        `moduleStats=${JSON.stringify(result.moduleStats)}`,
        `sinkProfile=${JSON.stringify(result.sinkProfile)}`,
        `sinkAudit=${JSON.stringify(result.sinkAudit)}`,
        `entryIr=${JSON.stringify(result.entryIr)}`,
    ].join("\n");
}

function describeMethodIr(method: any): unknown[] {
    return (method.getCfg?.()?.getStmts?.() || []).map((stmt: any) => {
        const invokeExpr = stmt.containsInvokeExpr?.() ? stmt.getInvokeExpr?.() : undefined;
        return {
            stmt: String(stmt.toString?.() || stmt),
            invokeSig: invokeExpr?.getMethodSignature?.()?.toString?.() || undefined,
            invokeClass: invokeExpr?.constructor?.name || undefined,
            args: (invokeExpr?.getArgs?.() || []).map((arg: any) => String(arg.toString?.() || arg)),
        };
    });
}

type FixtureInvokeSelector = {
    methodName?: string;
    declaringClassName?: string;
    argCount?: number;
    instanceOnly?: boolean;
    staticOnly?: boolean;
};

type FixtureMethodSelector = {
    methodSignature?: string;
    methodName?: string;
    declaringClassName?: string;
};

const fixtureInvokeDeclarations = [
    ...eventBusMethodInputs().map(input => ({ kind: "class" as const, input })),
    ...routerMethodInputs().map(input => ({ kind: "class" as const, input })),
    ...storageMethodInputs().map(input => ({ kind: "class" as const, input })),
    ...bridgeClassMethodInputs().map(input => ({ kind: "class" as const, input })),
    ...bridgeFreeFunctionInputs().map(input => ({ kind: "function" as const, input })),
];

function invoke(selector: FixtureInvokeSelector): ModuleSemanticSurfaceRef {
    return {
        kind: "invoke",
        selector: {
            surfaceKind: "invoke",
            canonicalApiId: canonicalApiIdForFixtureInvokeSelector(selector),
        },
    };
}

function method(selector: FixtureMethodSelector): ModuleSemanticSurfaceRef {
    return {
        kind: "method",
        selector: {
            methodSignature: methodSignatureForFixtureMethodSelector(selector),
        },
    };
}

function arg(surface: ModuleSemanticSurfaceRef, index: number, fieldPath?: string[]) {
    return {
        surface,
        slot: "arg" as const,
        index,
        ...(fieldPath ? { fieldPath } : {}),
    };
}

function result(surface: ModuleSemanticSurfaceRef, fieldPath?: string[]) {
    return {
        surface,
        slot: "result" as const,
        ...(fieldPath ? { fieldPath } : {}),
    };
}

function callbackParam(surface: ModuleSemanticSurfaceRef, callbackArgIndex?: number, paramIndex?: number, fieldPath?: string[]) {
    return {
        surface,
        slot: "callback_param" as const,
        ...(callbackArgIndex !== undefined ? { callbackArgIndex } : {}),
        ...(paramIndex !== undefined ? { paramIndex } : {}),
        ...(fieldPath ? { fieldPath } : {}),
    };
}

function methodThis(surface: ModuleSemanticSurfaceRef) {
    return {
        surface,
        slot: "method_this" as const,
    };
}

function methodParam(surface: ModuleSemanticSurfaceRef, paramIndex: number, fieldPath?: string[]) {
    return {
        surface,
        slot: "method_param" as const,
        paramIndex,
        ...(fieldPath ? { fieldPath } : {}),
    };
}

function fieldLoad(surface: ModuleSemanticSurfaceRef, fieldName: string, baseThisOnly = true) {
    return {
        surface,
        slot: "field_load" as const,
        fieldName,
        baseThisOnly,
    };
}

function canonicalApiIdForFixtureInvokeSelector(selector: FixtureInvokeSelector): string {
    const matches = fixtureInvokeDeclarations.filter(item => {
        const methodName = item.kind === "class" ? item.input.methodName : item.input.functionName;
        if (selector.methodName && selector.methodName !== methodName) return false;
        if (selector.argCount !== undefined && selector.argCount !== item.input.parameterTypes.length) return false;
        if (selector.declaringClassName !== undefined) {
            if (item.kind !== "class" || item.input.className !== selector.declaringClassName) return false;
        }
        if (selector.instanceOnly && (item.kind !== "class" || item.input.staticMember)) return false;
        if (selector.staticOnly && (item.kind !== "class" || !item.input.staticMember)) return false;
        return true;
    });
    if (matches.length !== 1) {
        throw new Error(`fixture invoke selector must match exactly one declaration: ${JSON.stringify(selector)} matched ${matches.length}`);
    }
    const [match] = matches;
    return match.kind === "class"
        ? projectClassMethodCanonicalApiId(match.input)
        : projectFreeFunctionCanonicalApiId(match.input);
}

function methodSignatureForFixtureMethodSelector(selector: FixtureMethodSelector): string {
    if (selector.methodSignature) return selector.methodSignature;
    const classMatches = bridgeClassMethodInputs().filter(input => {
        if (selector.methodName && selector.methodName !== input.methodName) return false;
        if (selector.declaringClassName && selector.declaringClassName !== input.className) return false;
        return true;
    });
    if (classMatches.length !== 1) {
        throw new Error(`fixture method selector must match exactly one class method: ${JSON.stringify(selector)} matched ${classMatches.length}`);
    }
    const [input] = classMatches;
    return `@${input.modulePath}: ${input.className}.${input.methodName}(${input.parameterTypes.join(", ")})`;
}

function mainEmit(reason: string, boundary?: "identity" | "serialized_copy" | "clone_copy" | "stringify_result") {
    return {
        reason,
        allowUnreachableTarget: true,
        ...(boundary ? { boundary } : {}),
    };
}

async function main(): Promise<void> {
    const root = resolveTestRunDir("runtime", "module_spec_engine");
    const repoRoot = resolveTestRunPath("runtime", "module_spec_engine", "fixtures", "repo");
    const sourceDir = path.join(repoRoot, "src", "main", "ets");
    const projectRulePath = resolveTestRunPath("runtime", "module_spec_engine", "fixtures", "project.rules.json");
    const registryPath = resolveTestRunPath("runtime", "module_spec_engine", "fixtures", "canonical_api_registry.json");
    const callbackSpecFile = resolveTestRunPath("runtime", "module_spec_engine", "fixtures", "callback_spec.json");
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });

    writeText(
        path.join(sourceDir, "callback_case.ets"),
        [
            "function Source(): string {",
            "  return \"taint\";",
            "}",
            "",
            "function Register(value: string, callback: (observed: string) => void): void {}",
            "function Sink(v: string): void {}",
            "",
            "function callback_case(): void {",
            "  const value = Source();",
            "  Register(value, (observed: string) => {",
            "    Sink(observed);",
            "  });",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        path.join(sourceDir, "carrier_case.ets"),
        [
            "class Bus {",
            "  onMessage(callback: (payload: string) => void): void {}",
            "  postMessage(value: string): void {}",
            "}",
            "",
            "function Source(): string {",
            "  return \"taint\";",
            "}",
            "",
            "function Sink(v: string): void {}",
            "",
            "function carrier_case(): void {",
            "  const bus = new Bus();",
            "  bus.onMessage((payload: string) => {",
            "    Sink(payload);",
            "  });",
            "  bus.postMessage(Source());",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        path.join(sourceDir, "emitter_scope_case.ets"),
        [
            "class EventBusA {",
            "  on(topic: string, callback: (payload: string) => void): void {}",
            "  emit(topic: string, payload: string): void {}",
            "}",
            "",
            "class EventBusB {",
            "  on(topic: string, callback: (payload: string) => void): void {}",
            "  emit(topic: string, payload: string): void {}",
            "}",
            "",
            "function Source(): string {",
            "  return \"taint\";",
            "}",
            "function Sink(v: string): void {}",
            "",
            "function emitter_scope_case(): void {",
            "  const busA = new EventBusA();",
            "  const busB = new EventBusB();",
            "  busA.on(\"ready\", (payload: string) => {",
            "    Sink(payload);",
            "  });",
            "  busB.emit(\"ready\", Source());",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        path.join(sourceDir, "keyed_state_case.ets"),
        [
            "function Source(): string {",
            "  return \"taint\";",
            "}",
            "",
            "function Put(key: string, value: string): void {}",
            "function Get(key: string): string {",
            "  return \"clean\";",
            "}",
            "function Sink(v: string): void {}",
            "",
            "function keyed_state_case(): void {",
            "  Put(\"session\", Source());",
            "  const observed = Get(\"session\");",
            "  Sink(observed);",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        path.join(sourceDir, "same_address_case.ets"),
        [
            "function Source(): string {",
            "  return \"taint\";",
            "}",
            "",
            "function PutAddress(key: string, value: string): void {}",
            "function GetAddress(key: string): string {",
            "  return \"clean\";",
            "}",
            "function Sink(v: string): void {}",
            "",
            "function same_address_case(): void {",
            "  PutAddress(\"token\", Source());",
            "  const observed = GetAddress(\"token\");",
            "  Sink(observed);",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        path.join(sourceDir, "method_field_state_case.ets"),
        [
            "class Lifecycle020 {",
            "  saved: string = \"\";",
            "",
            "  onCreate(want: string): void {}",
            "",
            "  render(): void {",
            "    Sink(this.saved);",
            "  }",
            "}",
            "",
            "function Source(): string {",
            "  return \"taint\";",
            "}",
            "function Sink(v: string): void {}",
            "",
            "function method_field_state_case(): void {",
            "  const page = new Lifecycle020();",
            "  page.onCreate(Source());",
            "  page.render();",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        path.join(sourceDir, "declarative_case.ets"),
        [
            "class WatchBox {",
            "  token: string = \"\";",
            "",
            "  setToken(value: string): void {",
            "    this.token = value;",
            "  }",
            "",
            "  onTokenChanged(): void {",
            "    Sink(this.token);",
            "  }",
            "}",
            "",
            "function Source(): string {",
            "  return \"taint\";",
            "}",
            "function Sink(v: string): void {}",
            "",
            "function declarative_case(): void {",
            "  const box = new WatchBox();",
            "  box.setToken(Source());",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        path.join(sourceDir, "method_param_case.ets"),
        [
            "class AbilityContext {",
            "  startAbility(want: string): void {}",
            "}",
            "",
            "class DemoAbility {",
            "  onCreate(want: string): void {",
            "    Sink(want);",
            "  }",
            "}",
            "",
            "function Source(): string {",
            "  return \"taint\";",
            "}",
            "function Sink(v: string): void {}",
            "",
            "function method_param_case(): void {",
            "  const context = new AbilityContext();",
            "  const ability = new DemoAbility();",
            "  context.startAbility(Source());",
            "  ability.onCreate(\"clean\");",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        path.join(sourceDir, "emitter_case.ets"),
        [
            "class EventBus {",
            "  on(topic: string, callback: (payload: string) => void): void {}",
            "  emit(topic: string, payload: string): void {}",
            "}",
            "",
            "function Source(): string {",
            "  return \"taint\";",
            "}",
            "function Sink(v: string): void {}",
            "",
            "function emitter_case(): void {",
            "  const bus = new EventBus();",
            "  bus.on(\"ready\", (payload: string) => {",
            "    Sink(payload);",
            "  });",
            "  bus.emit(\"ready\", Source());",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        path.join(sourceDir, "router_unwrap_case.ets"),
        [
            "class RoutePushParams {",
            "  secret: string = \"\";",
            "}",
            "",
            "class RoutePushOptions {",
            "  route: string = \"\";",
            "  params: RoutePushParams = new RoutePushParams();",
            "}",
            "",
            "class RouteResultParams {",
            "  secret: string = \"\";",
            "}",
            "",
            "class RouterLike {",
            "  static pushRouteWrapped(options: RoutePushOptions): void {}",
            "  static getRouteParams(): RouteResultParams {",
            "    return new RouteResultParams();",
            "  }",
            "}",
            "",
            "function Source(): string {",
            "  return \"taint\";",
            "}",
            "function Sink(v: string): void {}",
            "",
            "function router_unwrap_case(): void {",
            "  const options = new RoutePushOptions();",
            "  options.route = \"home\";",
            "  options.params.secret = Source();",
            "  RouterLike.pushRouteWrapped(options);",
            "  const params = RouterLike.getRouteParams();",
            "  Sink(params.secret);",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        path.join(sourceDir, "storage_prop_case.ets"),
        [
            "function StorageProp(_key: string): any {",
            "  return (_target: any, _field: string) => {};",
            "}",
            "",
            "class StorageHubProp {",
            "  static putValue(key: string, value: string): void {}",
            "}",
            "",
            "class StorageView006 {",
            "  @StorageProp(\"token\")",
            "  token: string = \"\";",
            "",
            "  render(): void {",
            "    Sink(this.token);",
            "  }",
            "}",
            "",
            "function Source(): string {",
            "  return \"taint\";",
            "}",
            "function Sink(v: string): void {}",
            "",
            "function storage_prop_case(): void {",
            "  StorageHubProp.putValue(\"token\", Source());",
            "  const view = new StorageView006();",
            "  view.render();",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        path.join(sourceDir, "storage_prop_mismatch_case.ets"),
        [
            "function StorageProp(_key: string): any {",
            "  return (_target: any, _field: string) => {};",
            "}",
            "",
            "class StorageHubPropMismatch {",
            "  static putValue(key: string, value: string): void {}",
            "}",
            "",
            "class StorageView007 {",
            "  @StorageProp(\"safe\")",
            "  token: string = \"\";",
            "",
            "  render(): void {",
            "    Sink(this.token);",
            "  }",
            "}",
            "",
            "function Source(): string {",
            "  return \"taint\";",
            "}",
            "function Sink(v: string): void {}",
            "",
            "function storage_prop_mismatch_case(): void {",
            "  StorageHubPropMismatch.putValue(\"token\", Source());",
            "  const view = new StorageView007();",
            "  view.render();",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        path.join(sourceDir, "provide_consume_case.ets"),
        [
            "function Provide(_key: string): any {",
            "  return (_target: any, _field: string) => {};",
            "}",
            "function Consume(_key: string): any {",
            "  return (_target: any, _field: string) => {};",
            "}",
            "",
            "class Provider009 {",
            "  @Provide(\"token\")",
            "  token: string = \"\";",
            "",
            "  update(v: string): void {",
            "    this.token = v;",
            "  }",
            "}",
            "",
            "class Consumer009 {",
            "  @Consume(\"token\")",
            "  token: string = \"\";",
            "",
            "  render(): void {",
            "    Sink(this.token);",
            "  }",
            "}",
            "",
            "function Source(): string {",
            "  return \"taint\";",
            "}",
            "function Sink(v: string): void {}",
            "",
            "function provide_consume_case(): void {",
            "  const provider = new Provider009();",
            "  const consumer = new Consumer009();",
            "  provider.update(Source());",
            "  consumer.render();",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        path.join(sourceDir, "container_map_case.ets"),
        [
            "function Source(): string {",
            "  return \"taint\";",
            "}",
            "",
            "function Sink(v: string): void {}",
            "",
            "function container_map_case(): void {",
            "  const cache = new Map<string, string>();",
            "  cache.set(\"token\", Source());",
            "  const value = cache.get(\"token\");",
            "  Sink(value);",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        path.join(sourceDir, "stringify_boundary_case.ets"),
        [
            "class StringifyPayload013 {",
            "  token: string = \"\";",
            "}",
            "",
            "function JsonStringify013(value: StringifyPayload013): string {",
            "  return \"clean\";",
            "}",
            "function Source(): string {",
            "  return \"taint\";",
            "}",
            "function Sink(v: string): void {}",
            "",
            "function stringify_boundary_case(): void {",
            "  const payload = new StringifyPayload013();",
            "  payload.token = Source();",
            "  const out = JsonStringify013(payload);",
            "  Sink(out);",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        path.join(sourceDir, "clone_copy_boundary_case.ets"),
        [
            "class CloneSource014 {",
            "  token: string = \"\";",
            "}",
            "",
            "class CloneTarget014 {",
            "  token: string = \"\";",
            "}",
            "",
            "function SaveClone014(value: CloneSource014): void {}",
            "function LoadClone014(): CloneTarget014 {",
            "  return new CloneTarget014();",
            "}",
            "function Source(): string {",
            "  return \"taint\";",
            "}",
            "function Sink(v: string): void {}",
            "",
            "function clone_copy_boundary_case(): void {",
            "  const payload = new CloneSource014();",
            "  payload.token = Source();",
            "  SaveClone014(payload);",
            "  const out = LoadClone014();",
            "  Sink(out.token);",
            "}",
            "",
        ].join("\n"),
    );

    writeFixtureRuleAsset(projectRulePath, "fixture.internal_module_lowering_ir");
    writeFixtureCanonicalRegistry(registryPath);

    const callbackSpec: InternalModuleLoweringIR = {
        id: "fixture.spec.callback_bridge",
        semantics: [
            {
                kind: "bridge",
                from: arg(invoke({ methodName: "Register", argCount: 2 }), 0),
                to: callbackParam(invoke({ methodName: "Register", argCount: 2 }), 1),
                emit: {
                    allowUnreachableTarget: true,
                },
            },
        ],
    };
    writeText(callbackSpecFile, JSON.stringify(callbackSpec, null, 2));

    const carrierSpec: InternalModuleLoweringIR = {
        id: "fixture.spec.same_receiver_callback",
        description: "Bridge bus.postMessage(value) into bus.onMessage(callback) on the same receiver.",
        semantics: [
            {
                id: "bus_callback",
                kind: "bridge",
                from: arg(invoke({ methodName: "postMessage", instanceOnly: true, argCount: 1 }), 0),
                to: callbackParam(invoke({ methodName: "onMessage", instanceOnly: true, argCount: 1 }), 0, 0),
                constraints: [
                    {
                        kind: "same_receiver",
                    },
                ],
                dispatch: {
                    preset: "callback_event",
                    reason: "Fixture-SameReceiver",
                },
                emit: mainEmit("Fixture-SameReceiver"),
            },
        ],
    };

    const keyedStateSpec: InternalModuleLoweringIR = {
        id: "fixture.spec.keyed_state",
        description: "Bridge Put(key, value) into Get(key) via keyed state.",
        semantics: [
            {
                id: "keyed_state",
                kind: "state",
                cell: {
                    kind: "keyed_state",
                    label: "fixture.keyed_state",
                },
                writes: [
                    {
                        from: arg(invoke({ methodName: "Put", argCount: 2 }), 1),
                        address: {
                            kind: "endpoint",
                            endpoint: arg(invoke({ methodName: "Put", argCount: 2 }), 0),
                        },
                        emit: mainEmit("Fixture-KeyedState"),
                    },
                ],
                reads: [
                    {
                        to: result(invoke({ methodName: "Get", argCount: 1 })),
                        address: {
                            kind: "endpoint",
                            endpoint: arg(invoke({ methodName: "Get", argCount: 1 }), 0),
                        },
                        emit: mainEmit("Fixture-KeyedState"),
                    },
                ],
            },
        ],
    };

    const sameAddressSpec: InternalModuleLoweringIR = {
        id: "fixture.spec.same_address_bridge",
        description: "Bridge PutAddress(key, value) into GetAddress(key) using bridge-level same_address.",
        semantics: [
            {
                id: "same_address",
                kind: "bridge",
                from: arg(invoke({ methodName: "PutAddress", argCount: 2 }), 1),
                to: result(invoke({ methodName: "GetAddress", argCount: 1 })),
                constraints: [
                    {
                        kind: "same_address",
                        left: {
                            kind: "endpoint",
                            endpoint: arg(invoke({ methodName: "PutAddress", argCount: 2 }), 0),
                        },
                        right: {
                            kind: "endpoint",
                            endpoint: arg(invoke({ methodName: "GetAddress", argCount: 1 }), 0),
                        },
                    },
                ],
                emit: mainEmit("Fixture-SameAddress"),
            },
        ],
    };

    const methodFieldStateSpec: InternalModuleLoweringIR = {
        id: "fixture.spec.method_field_state",
        description: "Persist Lifecycle020.onCreate(want) into this.saved and read it in render().",
        semantics: [
            {
                id: "lifecycle_state",
                kind: "state",
                cell: {
                    kind: "field",
                    carrier: methodThis(method({ declaringClassName: "Lifecycle020", methodName: "onCreate" })),
                    fieldPath: ["saved"],
                },
                writes: [
                    {
                        from: methodParam(method({ declaringClassName: "Lifecycle020", methodName: "onCreate" }), 0),
                        emit: mainEmit("Fixture-MethodFieldState"),
                    },
                ],
                reads: [
                    {
                        to: fieldLoad(method({ declaringClassName: "Lifecycle020", methodName: "render" }), "saved", true),
                        emit: mainEmit("Fixture-MethodFieldState"),
                    },
                ],
            },
        ],
    };

    const declarativeSpec: InternalModuleLoweringIR = {
        id: "fixture.spec.declarative_binding",
        description: "Trigger onTokenChanged after setToken.",
        semantics: [
            {
                id: "watchbox_binding",
                kind: "declarative_binding",
                source: method({ declaringClassName: "WatchBox", methodName: "setToken" }),
                handler: method({ declaringClassName: "WatchBox", methodName: "onTokenChanged" }),
                triggerLabel: "WatchBox#token",
                dispatch: {
                    preset: "declarative_field",
                    reason: "Fixture-Declarative",
                },
            },
        ],
    };

    const abilitySpec: InternalModuleLoweringIR = {
        id: "fixture.spec.ability_handoff",
        description: "Bridge startAbility(want) into DemoAbility.onCreate(want).",
        semantics: [
            {
                kind: "bridge",
                from: arg(invoke({ methodName: "startAbility" }), 0),
                to: methodParam(method({ declaringClassName: "DemoAbility", methodName: "onCreate" }), 0),
                emit: {
                    allowUnreachableTarget: true,
                },
            },
        ],
    };

    const emitterApiIds = eventEmitterProjectApiIds();
    const emitterSpec: InternalModuleLoweringIR = {
        id: "fixture.spec.event_emitter",
        description: "Bridge emit(topic, payload) into on(topic, callback).",
        semantics: [
            {
                id: "event_emitter",
                kind: "event_emitter",
                onCanonicalApiIds: emitterApiIds.on,
                emitCanonicalApiIds: emitterApiIds.emit,
                payloadArgIndex: 1,
                callbackArgIndex: 1,
                callbackParamIndex: 0,
                maxCandidates: 8,
            },
        ],
    };

    const routerApiIds = routerProjectApiIds();
    const routerSpec: InternalModuleLoweringIR = {
        id: "fixture.spec.route_bridge",
        description: "Bridge pushRouteWrapped(options.route/options.params.*) into getRouteParams().*.",
        semantics: [
            {
                id: "route_bridge",
                kind: "route_bridge",
                pushApis: [
                    {
                        canonicalApiIds: [routerApiIds.pushRouteWrapped],
                        routeField: "route",
                    },
                ],
                getCanonicalApiIds: [routerApiIds.getRouteParams],
                payloadUnwrapPrefixes: ["params"],
            },
        ],
    };

    const storageApiIds = keyedStorageProjectApiIds();
    const appStoragePayload = capabilityPayload(harmonyAppStorageModuleAsset);
    const statePayload = capabilityPayload(harmonyStateModuleAsset);
    const containerPayload = capabilityPayload(tsjsContainerModuleAsset);
    const storagePropSpec: InternalModuleLoweringIR = {
        id: "fixture.spec.keyed_storage",
        description: "Bridge StorageHubProp.putValue(key, value) into @StorageProp field reads.",
        semantics: [
            {
                kind: "keyed_storage",
                writeApis: [
                    { canonicalApiIds: storageApiIds.putValue, valueIndex: 1 },
                ],
                readCanonicalApiIds: [],
                propDecoratorCanonicalApiIds: appStoragePayload.propDecoratorCanonicalApiIds,
                linkDecoratorCanonicalApiIds: appStoragePayload.linkDecoratorCanonicalApiIds,
            },
        ],
    };

    const provideConsumeSpec: InternalModuleLoweringIR = {
        id: "fixture.spec.state_binding",
        description: "Bridge @Provide fields into @Consume fields.",
        semantics: [
            {
                id: "provide_consume",
                kind: "state_binding",
                stateDecoratorCanonicalApiIds: statePayload.stateDecoratorCanonicalApiIds,
                propDecoratorCanonicalApiIds: statePayload.propDecoratorCanonicalApiIds,
                linkDecoratorCanonicalApiIds: statePayload.linkDecoratorCanonicalApiIds,
                provideDecoratorCanonicalApiIds: statePayload.provideDecoratorCanonicalApiIds,
                consumeDecoratorCanonicalApiIds: statePayload.consumeDecoratorCanonicalApiIds,
            },
        ],
    };

    const containerSpec: InternalModuleLoweringIR = {
        id: "fixture.spec.container",
        description: "Enable map-family container storage/load semantics.",
        semantics: [
            {
                id: "map_container",
                kind: "container",
                families: ["map"],
                capabilities: ["store", "load"],
                mutationCanonicalApiIds: containerPayload.mutationCanonicalApiIds,
                accessCanonicalApiIds: containerPayload.accessCanonicalApiIds,
            },
        ],
    };

    const stringifyBoundarySpec: InternalModuleLoweringIR = {
        id: "fixture.spec.stringify_boundary",
        description: "Project payload.token into stringify result.",
        semantics: [
            {
                id: "stringify_bridge",
                kind: "bridge",
                from: arg(invoke({ methodName: "JsonStringify013", argCount: 1 }), 0, ["token"]),
                to: result(invoke({ methodName: "JsonStringify013", argCount: 1 })),
                emit: mainEmit("Fixture-StringifyBoundary", "stringify_result"),
            },
        ],
    };

    const cloneCopyBoundarySpec: InternalModuleLoweringIR = {
        id: "fixture.spec.clone_copy_boundary",
        description: "Bridge SaveClone014(value) into LoadClone014() with clone-copy semantics.",
        semantics: [
            {
                id: "clone_copy",
                kind: "state",
                cell: {
                    kind: "keyed_state",
                    label: "fixture.clone_copy",
                },
                writes: [
                    {
                        from: arg(invoke({ methodName: "SaveClone014", argCount: 1 }), 0),
                        address: {
                            kind: "literal",
                            value: "clone_slot",
                        },
                        emit: mainEmit("Fixture-CloneCopy", "clone_copy"),
                    },
                ],
                reads: [
                    {
                        to: result(invoke({ methodName: "LoadClone014", argCount: 0 })),
                        address: {
                            kind: "literal",
                            value: "clone_slot",
                        },
                        emit: mainEmit("Fixture-CloneCopy", "clone_copy"),
                    },
                ],
            },
        ],
    };

    const invalidSpec = {
        id: "fixture.spec.invalid",
        description: "invalid spec for validation coverage",
        semantics: [
            {
                id: "broken_bridge",
                kind: "bridge",
                from: {
                    surface: {
                        kind: "invoke_surface",
                        selector: {
                            methodName: "postMessage",
                        },
                    },
                    slot: "argument",
                    index: 0,
                },
                to: {
                    surface: {
                        kind: "invoke",
                        selector: {
                            methodName: "onMessage",
                        },
                    },
                    slot: "callback_param",
                },
                dispatch: {
                    preset: "async_callback",
                },
            },
        ],
    };

    expectCompileError(invalidSpec, [
        "semantics[0].from.surface.kind must be one of: \"invoke\", \"method\", \"decorated_field\"",
        "semantics[0].from.slot must be one of: \"arg\", \"base\", \"result\", \"callback_param\", \"method_this\", \"method_param\", \"field_load\", \"decorated_field_value\"",
        "semantics[0].dispatch.preset must be one of: \"callback_sync\", \"callback_event\", \"promise_fulfilled\", \"promise_rejected\", \"promise_any\", \"declarative_field\"",
    ]);

    expectCompileError({
        id: "invalid_fallback_mode",
        semantics: [
            {
                kind: "bridge",
                from: { surface: "postMessage", slot: "arg", index: 0 },
                to: { surface: "onMessage", slot: "callback_param" },
                constraints: [
                    {
                        kind: "same_receiver",
                        fallbackMode: "all_targets_if_unmatched",
                    },
                ],
            },
        ],
    }, [
        "semantics[0].constraints[0].fallbackMode",
        "is not supported",
    ]);

    const scene = buildScene(repoRoot);
    const selectedCase = process.env.ARKTAINT_INTERNAL_MODULE_CASE;
    if (selectedCase) {
        const cases: Record<string, { relativePath: string; caseName: string; spec?: InternalModuleLoweringIR }> = {
            callback: { relativePath: "callback_case.ets", caseName: "callback_case", spec: callbackSpec },
            carrier: { relativePath: "carrier_case.ets", caseName: "carrier_case", spec: carrierSpec },
            emitter_scope: { relativePath: "emitter_scope_case.ets", caseName: "emitter_scope_case", spec: emitterSpec },
            keyed_state: { relativePath: "keyed_state_case.ets", caseName: "keyed_state_case", spec: keyedStateSpec },
            same_address: { relativePath: "same_address_case.ets", caseName: "same_address_case", spec: sameAddressSpec },
            method_field_state: { relativePath: "method_field_state_case.ets", caseName: "method_field_state_case", spec: methodFieldStateSpec },
            declarative: { relativePath: "declarative_case.ets", caseName: "declarative_case", spec: declarativeSpec },
            method_param: { relativePath: "method_param_case.ets", caseName: "method_param_case", spec: abilitySpec },
            emitter: { relativePath: "emitter_case.ets", caseName: "emitter_case", spec: emitterSpec },
            router: { relativePath: "router_unwrap_case.ets", caseName: "router_unwrap_case", spec: routerSpec },
            storage_prop: { relativePath: "storage_prop_case.ets", caseName: "storage_prop_case", spec: storagePropSpec },
            storage_prop_mismatch: { relativePath: "storage_prop_mismatch_case.ets", caseName: "storage_prop_mismatch_case", spec: storagePropSpec },
            provide_consume: { relativePath: "provide_consume_case.ets", caseName: "provide_consume_case", spec: provideConsumeSpec },
            container: { relativePath: "container_map_case.ets", caseName: "container_map_case", spec: containerSpec },
            stringify: { relativePath: "stringify_boundary_case.ets", caseName: "stringify_boundary_case", spec: stringifyBoundarySpec },
            clone_copy: { relativePath: "clone_copy_boundary_case.ets", caseName: "clone_copy_boundary_case", spec: cloneCopyBoundarySpec },
        };
        const target = cases[selectedCase];
        assert(!!target, `unknown ARKTAINT_INTERNAL_MODULE_CASE ${selectedCase}`);
        const baseline = await runCase(scene, target.relativePath, target.caseName, {});
        const withSpec = target.spec
            ? await runCase(scene, target.relativePath, target.caseName, moduleOptionsFromSpec(target.spec))
            : baseline;
        if (process.env.ARKTAINT_INTERNAL_MODULE_COMPACT === "1") {
            console.log(JSON.stringify({
                case: selectedCase,
                baselineFlows: baseline.totalFlows,
                withSpecFlows: withSpec.totalFlows,
                baselineDeferredContracts: baseline.deferredContractCount,
                withSpecDeferredContracts: withSpec.deferredContractCount,
                withSpecEmissionCount: Object.values(withSpec.moduleStats)
                    .reduce((sum: number, item: any) => sum + Number(item.totalEmissionCount || 0), 0),
                loadedModuleIds: withSpec.loadedModuleIds,
            }));
            return;
        }
        console.log(formatRunCaseDebug(`${selectedCase}:baseline`, baseline));
        console.log(formatRunCaseDebug(`${selectedCase}:withSpec`, withSpec));
        return;
    }

    const callbackBaseline = await runCase(scene, "callback_case.ets", "callback_case", {});
    const callbackWithFileSpec = await runCase(scene, "callback_case.ets", "callback_case", {
        ...moduleOptionsFromSpec(callbackSpec),
    });
    const carrierBaseline = await runCase(scene, "carrier_case.ets", "carrier_case", {});
    const carrierWithSpec = await runCase(scene, "carrier_case.ets", "carrier_case", moduleOptionsFromSpec(carrierSpec));
    const emitterScopeBaseline = await runCase(scene, "emitter_scope_case.ets", "emitter_scope_case", {});
    const emitterScopeWithSpec = await runCase(scene, "emitter_scope_case.ets", "emitter_scope_case", moduleOptionsFromSpec(emitterSpec));
    const keyedStateBaseline = await runCase(scene, "keyed_state_case.ets", "keyed_state_case", {});
    const keyedStateWithSpec = await runCase(scene, "keyed_state_case.ets", "keyed_state_case", moduleOptionsFromSpec(keyedStateSpec));
    const sameAddressBaseline = await runCase(scene, "same_address_case.ets", "same_address_case", {});
    const sameAddressWithSpec = await runCase(scene, "same_address_case.ets", "same_address_case", moduleOptionsFromSpec(sameAddressSpec));
    const methodFieldStateBaseline = await runCase(scene, "method_field_state_case.ets", "method_field_state_case", {});
    const methodFieldStateWithSpec = await runCase(scene, "method_field_state_case.ets", "method_field_state_case", moduleOptionsFromSpec(methodFieldStateSpec));
    const declarativeBaseline = await runCase(scene, "declarative_case.ets", "declarative_case", {});
    const declarativeWithSpec = await runCase(scene, "declarative_case.ets", "declarative_case", moduleOptionsFromSpec(declarativeSpec));
    const methodParamBaseline = await runCase(scene, "method_param_case.ets", "method_param_case", {});
    const methodParamWithSpec = await runCase(scene, "method_param_case.ets", "method_param_case", moduleOptionsFromSpec(abilitySpec));
    const emitterBaseline = await runCase(scene, "emitter_case.ets", "emitter_case", {});
    const emitterWithSpec = await runCase(scene, "emitter_case.ets", "emitter_case", moduleOptionsFromSpec(emitterSpec));
    const routerBaseline = await runCase(scene, "router_unwrap_case.ets", "router_unwrap_case", {});
    const routerWithSpec = await runCase(scene, "router_unwrap_case.ets", "router_unwrap_case", moduleOptionsFromSpec(routerSpec));
    const storagePropBaseline = await runCase(scene, "storage_prop_case.ets", "storage_prop_case", {});
    const storagePropWithSpec = await runCase(scene, "storage_prop_case.ets", "storage_prop_case", moduleOptionsFromSpec(storagePropSpec));
    const storagePropMismatchBaseline = await runCase(scene, "storage_prop_mismatch_case.ets", "storage_prop_mismatch_case", {});
    const storagePropMismatchWithSpec = await runCase(scene, "storage_prop_mismatch_case.ets", "storage_prop_mismatch_case", moduleOptionsFromSpec(storagePropSpec));
    const provideConsumeBaseline = await runCase(scene, "provide_consume_case.ets", "provide_consume_case", {});
    const provideConsumeWithSpec = await runCase(scene, "provide_consume_case.ets", "provide_consume_case", moduleOptionsFromSpec(provideConsumeSpec));
    const containerBaseline = await runCase(scene, "container_map_case.ets", "container_map_case", {});
    const containerWithSpec = await runCase(scene, "container_map_case.ets", "container_map_case", moduleOptionsFromSpec(containerSpec));
    const stringifyBaseline = await runCase(scene, "stringify_boundary_case.ets", "stringify_boundary_case", {});
    const stringifyWithSpec = await runCase(scene, "stringify_boundary_case.ets", "stringify_boundary_case", moduleOptionsFromSpec(stringifyBoundarySpec));
    const cloneCopyBaseline = await runCase(scene, "clone_copy_boundary_case.ets", "clone_copy_boundary_case", {});
    const cloneCopyWithSpec = await runCase(scene, "clone_copy_boundary_case.ets", "clone_copy_boundary_case", moduleOptionsFromSpec(cloneCopyBoundarySpec));

    assert(callbackBaseline.totalFlows === 0, `callback baseline should have zero flows, got ${callbackBaseline.totalFlows}`);
    assert(callbackWithFileSpec.totalFlows > 0, [
        `callback file-based InternalModuleLoweringIR should recover flows, got ${callbackWithFileSpec.totalFlows}`,
        formatRunCaseDebug("callbackBaseline", callbackBaseline),
        formatRunCaseDebug("callbackWithFileSpec", callbackWithFileSpec),
    ].join("\n"));
    assert(hasLoweredModule(callbackWithFileSpec.loadedModuleIds, callbackSpec.id), "callback file-based InternalModuleLoweringIR should appear in loaded module audit ids");
    assert(callbackWithFileSpec.deferredContractCount > callbackBaseline.deferredContractCount, "callback file-based InternalModuleLoweringIR should declare deferred contracts");

    assert(carrierBaseline.totalFlows === 0, `same-receiver baseline should have zero flows, got ${carrierBaseline.totalFlows}`);
    assert(carrierWithSpec.totalFlows > 0, `same-receiver InternalModuleLoweringIR should recover flows, got ${carrierWithSpec.totalFlows}`);
    assert(hasLoweredModule(carrierWithSpec.loadedModuleIds, carrierSpec.id), "same-receiver InternalModuleLoweringIR should appear in loaded module audit ids");
    assert(carrierWithSpec.deferredContractCount > carrierBaseline.deferredContractCount, "same-receiver InternalModuleLoweringIR should declare deferred contracts");

    assert(emitterScopeBaseline.totalFlows === 0, `emitter scope baseline should have zero flows, got ${emitterScopeBaseline.totalFlows}`);
    assert(emitterScopeWithSpec.totalFlows === 0, `event emitter InternalModuleLoweringIR should not bridge across different receiver classes, got ${emitterScopeWithSpec.totalFlows}`);

    assert(keyedStateBaseline.totalFlows === 0, `keyed state baseline should have zero flows, got ${keyedStateBaseline.totalFlows}`);
    assert(keyedStateWithSpec.totalFlows > 0, `keyed state InternalModuleLoweringIR should recover flows, got ${keyedStateWithSpec.totalFlows}`);
    assert(hasLoweredModule(keyedStateWithSpec.loadedModuleIds, keyedStateSpec.id), "keyed state InternalModuleLoweringIR should appear in loaded module audit ids");

    assert(sameAddressBaseline.totalFlows === 0, `same-address baseline should have zero flows, got ${sameAddressBaseline.totalFlows}`);
    assert(sameAddressWithSpec.totalFlows > 0, `same-address bridge InternalModuleLoweringIR should recover flows, got ${sameAddressWithSpec.totalFlows}`);
    assert(hasLoweredModule(sameAddressWithSpec.loadedModuleIds, sameAddressSpec.id), "same-address bridge InternalModuleLoweringIR should appear in loaded module audit ids");

    assert(methodFieldStateBaseline.totalFlows === 0, `method field state baseline should have zero flows, got ${methodFieldStateBaseline.totalFlows}`);
    assert(methodFieldStateWithSpec.totalFlows > 0, `method field state InternalModuleLoweringIR should recover flows, got ${methodFieldStateWithSpec.totalFlows}`);
    assert(hasLoweredModule(methodFieldStateWithSpec.loadedModuleIds, methodFieldStateSpec.id), "method field state InternalModuleLoweringIR should appear in loaded module audit ids");

    assert(declarativeBaseline.totalFlows === 0, `declarative baseline should have zero flows, got ${declarativeBaseline.totalFlows}`);
    assert(declarativeWithSpec.totalFlows > 0, `declarative InternalModuleLoweringIR should recover flows, got ${declarativeWithSpec.totalFlows}`);
    assert(hasLoweredModule(declarativeWithSpec.loadedModuleIds, declarativeSpec.id), "declarative InternalModuleLoweringIR should appear in loaded module audit ids");
    assert(declarativeWithSpec.deferredContractCount > declarativeBaseline.deferredContractCount, "declarative InternalModuleLoweringIR should declare deferred contracts");

    assert(methodParamBaseline.totalFlows === 0, `ability handoff baseline should have zero flows, got ${methodParamBaseline.totalFlows}`);
    assert(methodParamWithSpec.totalFlows > 0, `ability handoff InternalModuleLoweringIR should recover flows, got ${methodParamWithSpec.totalFlows}`);
    assert(hasLoweredModule(methodParamWithSpec.loadedModuleIds, abilitySpec.id), "ability handoff InternalModuleLoweringIR should appear in loaded module audit ids");

    assert(emitterBaseline.totalFlows === 0, `event emitter baseline should have zero flows, got ${emitterBaseline.totalFlows}`);
    assert(emitterWithSpec.totalFlows > 0, `event emitter InternalModuleLoweringIR should recover flows, got ${emitterWithSpec.totalFlows}`);
    assert(hasLoweredModule(emitterWithSpec.loadedModuleIds, emitterSpec.id), "event emitter InternalModuleLoweringIR should appear in loaded module audit ids");
    assert(emitterWithSpec.deferredContractCount > emitterBaseline.deferredContractCount, "event emitter InternalModuleLoweringIR should declare deferred contracts");

    assert(routerBaseline.totalFlows === 0, `route bridge baseline should have zero flows, got ${routerBaseline.totalFlows}`);
    assert(routerWithSpec.totalFlows > 0, `route bridge InternalModuleLoweringIR should recover flows, got ${routerWithSpec.totalFlows}`);
    assert(hasLoweredModule(routerWithSpec.loadedModuleIds, routerSpec.id), "route bridge InternalModuleLoweringIR should appear in loaded module audit ids");

    assert(storagePropBaseline.totalFlows === 0, `storage prop baseline should have zero flows, got ${storagePropBaseline.totalFlows}`);
    assert(storagePropWithSpec.totalFlows > 0, `keyed storage InternalModuleLoweringIR should recover prop flows, got ${storagePropWithSpec.totalFlows}`);
    assert(hasLoweredModule(storagePropWithSpec.loadedModuleIds, storagePropSpec.id), "keyed storage InternalModuleLoweringIR should appear in loaded module audit ids");
    assert(storagePropMismatchBaseline.totalFlows === 0, `storage prop mismatch baseline should have zero flows, got ${storagePropMismatchBaseline.totalFlows}`);
    assert(storagePropMismatchWithSpec.totalFlows === 0, `keyed storage InternalModuleLoweringIR should respect mismatched decorator keys, got ${storagePropMismatchWithSpec.totalFlows}`);

    assert(provideConsumeBaseline.totalFlows === 0, `state binding baseline should have zero flows, got ${provideConsumeBaseline.totalFlows}`);
    assert(provideConsumeWithSpec.totalFlows > 0, `state binding InternalModuleLoweringIR should recover provide/consume flows, got ${provideConsumeWithSpec.totalFlows}`);
    assert(hasLoweredModule(provideConsumeWithSpec.loadedModuleIds, provideConsumeSpec.id), "state binding InternalModuleLoweringIR should appear in loaded module audit ids");

    assert(containerBaseline.totalFlows === 0, `container baseline should have zero flows, got ${containerBaseline.totalFlows}`);
    assert(containerWithSpec.totalFlows > 0, `container InternalModuleLoweringIR should recover map flows, got ${containerWithSpec.totalFlows}`);
    assert(hasLoweredModule(containerWithSpec.loadedModuleIds, containerSpec.id), "container InternalModuleLoweringIR should appear in loaded module audit ids");

    assert(stringifyBaseline.totalFlows === 0, `stringify boundary baseline should have zero flows, got ${stringifyBaseline.totalFlows}`);
    assert(stringifyWithSpec.totalFlows > 0, `stringify boundary InternalModuleLoweringIR should recover flows, got ${stringifyWithSpec.totalFlows}`);
    assert(hasLoweredModule(stringifyWithSpec.loadedModuleIds, stringifyBoundarySpec.id), "stringify boundary InternalModuleLoweringIR should appear in loaded module audit ids");

    assert(cloneCopyBaseline.totalFlows === 0, `clone-copy baseline should have zero flows, got ${cloneCopyBaseline.totalFlows}`);
    assert(cloneCopyWithSpec.totalFlows > 0, `clone-copy InternalModuleLoweringIR should recover flows, got ${cloneCopyWithSpec.totalFlows}`);
    assert(hasLoweredModule(cloneCopyWithSpec.loadedModuleIds, cloneCopyBoundarySpec.id), "clone-copy InternalModuleLoweringIR should appear in loaded module audit ids");

    console.log("PASS test_internal_module_lowering_ir_engine");
    console.log(`callback_file_total_flows=${callbackWithFileSpec.totalFlows}`);
    console.log(`callback_deferred_contracts=${callbackWithFileSpec.deferredContractCount}`);
    console.log(`same_receiver_total_flows=${carrierWithSpec.totalFlows}`);
    console.log(`same_receiver_deferred_contracts=${carrierWithSpec.deferredContractCount}`);
    console.log(`emitter_scope_total_flows=${emitterScopeWithSpec.totalFlows}`);
    console.log(`keyed_state_total_flows=${keyedStateWithSpec.totalFlows}`);
    console.log(`same_address_total_flows=${sameAddressWithSpec.totalFlows}`);
    console.log(`method_field_state_total_flows=${methodFieldStateWithSpec.totalFlows}`);
    console.log(`declarative_total_flows=${declarativeWithSpec.totalFlows}`);
    console.log(`declarative_deferred_contracts=${declarativeWithSpec.deferredContractCount}`);
    console.log(`ability_handoff_total_flows=${methodParamWithSpec.totalFlows}`);
    console.log(`event_emitter_total_flows=${emitterWithSpec.totalFlows}`);
    console.log(`event_emitter_deferred_contracts=${emitterWithSpec.deferredContractCount}`);
    console.log(`route_bridge_total_flows=${routerWithSpec.totalFlows}`);
    console.log(`keyed_storage_total_flows=${storagePropWithSpec.totalFlows}`);
    console.log(`keyed_storage_mismatch_total_flows=${storagePropMismatchWithSpec.totalFlows}`);
    console.log(`state_binding_total_flows=${provideConsumeWithSpec.totalFlows}`);
    console.log(`container_total_flows=${containerWithSpec.totalFlows}`);
    console.log(`stringify_boundary_total_flows=${stringifyWithSpec.totalFlows}`);
    console.log(`clone_copy_total_flows=${cloneCopyWithSpec.totalFlows}`);
}

main().catch((error) => {
    console.error("FAIL test_internal_module_lowering_ir_engine");
    console.error(error);
    process.exit(1);
});
