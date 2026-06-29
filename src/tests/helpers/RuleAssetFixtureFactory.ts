import type {
    AssetBindingMetadata,
    AssetDocumentBase,
    AssetEndpoint,
    AssetSurface,
    RuleValueRef,
} from "../../core/assets/schema";
import { fromProjectDeclaration } from "../../core/api/identity";
import type { RuleInvokeKind } from "../../core/rules/RuleSchema";

interface FixtureStringConstraint {
    mode?: string;
    value?: string;
}

interface FixtureScopeConstraint {
    module?: FixtureStringConstraint;
    file?: FixtureStringConstraint;
    className?: FixtureStringConstraint;
    methodName?: FixtureStringConstraint;
}

type FixtureRuleSurface =
    | FixtureSignatureSurface
    | FixtureInvokeSurface
    | FixtureAccessSurface;

type FixtureInvokeSurfaceKind = Exclude<RuleInvokeKind, "any"> | "namespace" | "free-function";

interface FixtureSurfaceBase {
    modulePath?: string;
    ownerName?: string;
    ownerKind?: "namespace" | "class";
    invokeKind?: FixtureInvokeSurfaceKind;
    argCount?: number;
    parameterTypes?: string[];
    returnType?: string;
    typeHint?: string;
    calleeClass?: FixtureStringConstraint;
    scope?: FixtureScopeConstraint;
    calleeScope?: FixtureScopeConstraint;
    arkanalyzerDeclaringFileName?: string;
    arkanalyzerDeclaringClassName?: string;
    arkanalyzerMethodName?: string;
    arkanalyzerStaticFlag?: boolean;
}

interface FixtureSignatureSurface extends FixtureSurfaceBase {
    kind: "signature";
    signatureId: string;
    methodName?: string;
    functionName?: string;
}

interface FixtureInvokeSurface extends FixtureSurfaceBase {
    kind: "invoke";
    methodName?: string;
    functionName?: string;
    memberName?: string;
}

interface FixtureAccessSurface extends FixtureSurfaceBase {
    kind: "access";
    propertyName: string;
    accessKind?: "read" | "write" | "getter" | "setter";
    receiverKind?: "instance" | "static" | "namespace";
}

export interface SourceAssetFixtureRule {
    id: string;
    surface: FixtureRuleSurface;
    sourceKind: "seed_local_name" | "entry_param" | "call_return" | "call_arg" | "field_read" | "callback_param" | "bound_state";
    target?: RuleEndpointInput;
    metadata?: AssetBindingMetadata;
}

export interface SinkAssetFixtureRule {
    id: string;
    surface: FixtureRuleSurface;
    target?: RuleEndpointInput;
    metadata?: AssetBindingMetadata;
}

export interface SanitizerAssetFixtureRule {
    id: string;
    surface: FixtureRuleSurface;
    target?: RuleEndpointInput;
    metadata?: AssetBindingMetadata;
}

export interface TransferAssetFixtureRule {
    id: string;
    surface: FixtureRuleSurface;
    from: RuleEndpointInput;
    to: RuleEndpointInput;
    metadata?: AssetBindingMetadata;
}

export type RuleEndpointInput = RuleValueRef | "base" | "result" | `arg${number}` | undefined;

export interface RuleAssetFixtureInput {
    id: string;
    status?: AssetDocumentBase["status"];
    sources?: SourceAssetFixtureRule[];
    sinks?: SinkAssetFixtureRule[];
    sanitizers?: SanitizerAssetFixtureRule[];
    transfers?: TransferAssetFixtureRule[];
}

export function makeRuleAssetFixture(input: RuleAssetFixtureInput): AssetDocumentBase {
    const sourceRules = input.sources || [];
    const sinkRules = input.sinks || [];
    const sanitizerRules = input.sanitizers || [];
    const transferRules = input.transfers || [];
    const hasRules = sourceRules.length + sinkRules.length + sanitizerRules.length + transferRules.length > 0;
    const assetId = input.id;

    const asset: AssetDocumentBase = {
        id: assetId,
        plane: "rule",
        status: input.status || (hasRules ? "official" : "deprecated"),
        surfaces: [],
        bindings: [],
        effectTemplates: [],
        provenance: { source: "manual" },
    };

    sourceRules.forEach((rule, index) => {
        addRule(asset, "source", rule.id, rule.surface, index, rule.metadata, {
            id: `template.${rule.id}`,
            kind: "rule.source",
            value: endpoint(rule.target || "result"),
            sourceKind: rule.sourceKind,
            confidence: "certain",
        });
    });
    sinkRules.forEach((rule, index) => {
        addRule(asset, "sink", rule.id, rule.surface, index, rule.metadata, {
            id: `template.${rule.id}`,
            kind: "rule.sink",
            value: rule.target ? endpoint(rule.target) : undefined,
            sinkKind: "sink",
            confidence: "certain",
        });
    });
    sanitizerRules.forEach((rule, index) => {
        addRule(asset, "sanitizer", rule.id, rule.surface, index, rule.metadata, {
            id: `template.${rule.id}`,
            kind: "rule.sanitizer",
            value: rule.target ? endpoint(rule.target) : undefined,
            sanitizerKind: "sanitizer",
            strength: "strong",
            confidence: "certain",
        });
    });
    transferRules.forEach((rule, index) => {
        addRule(asset, "transfer", rule.id, rule.surface, index, rule.metadata, {
            id: `template.${rule.id}`,
            kind: "rule.transfer",
            from: endpoint(rule.from || "arg0"),
            to: endpoint(rule.to || "result"),
            transferKind: "direct",
            confidence: "certain",
        });
    });

    return asset;
}

export function stringifyRuleAssetFixture(input: RuleAssetFixtureInput): string {
    return JSON.stringify(makeRuleAssetFixture(input), null, 2);
}

export function ruleEndpoint(input: Exclude<RuleEndpointInput, undefined>): RuleValueRef {
    return endpoint(input);
}

function addRule(
    asset: AssetDocumentBase,
    role: "source" | "sink" | "sanitizer" | "transfer",
    ruleId: string,
    surfaceInput: FixtureRuleSurface,
    index: number,
    metadata: AssetBindingMetadata | undefined,
    template: NonNullable<AssetDocumentBase["effectTemplates"]>[number],
): void {
    const templateId = template.id;
    const surface = surfaceFromFixture(asset.id, role, ruleId, index, surfaceInput, template);
    asset.effectTemplates = asset.effectTemplates || [];
    asset.surfaces.push(surface);
    asset.effectTemplates.push(template);
    asset.bindings.push({
        bindingId: `binding.${ruleId}.${index}`,
        surfaceId: surface.surfaceId,
        canonicalApiId: surface.canonicalApiId,
        assetId: asset.id,
        plane: "rule",
        role,
        endpoint: endpointForRole(role, template),
        effectTemplateRefs: [templateId],
        semanticsFamily: metadata?.family || `test.${role}`,
        metadata,
        completeness: "complete",
        confidence: "certain",
    });
}

function endpointForRole(
    role: "source" | "sink" | "sanitizer" | "transfer",
    template: NonNullable<AssetDocumentBase["effectTemplates"]>[number],
): AssetEndpoint | undefined {
    if (role === "transfer") return undefined;
    const value = (template as any).value;
    return isAssetEndpoint(value) ? value : undefined;
}

function surfaceFromFixture(
    assetId: string,
    role: "source" | "sink" | "sanitizer" | "transfer",
    ruleId: string,
    index: number,
    surfaceInput: FixtureRuleSurface,
    template: NonNullable<AssetDocumentBase["effectTemplates"]>[number],
): AssetSurface {
    const modulePath = modulePathFromSurface(assetId, surfaceInput);
    const invokeKind = invokeKindFromSurface(surfaceInput);
    if (surfaceInput.kind === "access") {
        const ownerName = ownerNameFromSurface(surfaceInput, invokeKind);
        const returnType = surfaceInput.returnType || (role === "sink" ? "void" : "SyntheticTaintValue");
        const canonicalApiId = canonicalApiIdFromProjectDeclaration({
            domain: "local",
            modulePath,
            ownerName,
            ownerKind: surfaceInput.ownerKind || "namespace",
            memberName: surfaceInput.propertyName,
            memberKind: "property",
            invokeKind: "property-read",
            parameterTypes: [],
            returnType,
        });
        return {
            surfaceId: `surface.${assetId}.${ruleId}.${index}`,
            canonicalApiId,
            kind: "access",
            confidence: "certain",
            provenance: { source: "manual" },
        };
    }
    const methodName = methodNameFromSurface(surfaceInput);
    const argCount = surfaceInput.argCount ?? parameterTypesFromSurface(surfaceInput)?.length ?? 0;
    const parameterTypes = exactParameterTypesForSurface(surfaceInput, argCount);
    const returnType = surfaceInput.returnType || returnTypeForFixtureSurface(role, template);
    const ownerName = ownerNameFromSurface(surfaceInput, invokeKind);
    const ownerKind = surfaceInput.ownerKind || (invokeKind === "instance" || invokeKind === "static" ? "class" : "namespace");
    const memberKind = invokeKind === "instance" || invokeKind === "static" ? "method" : "function";
    const functionName = memberKind === "function" ? methodName : undefined;
    const arkanalyzerDeclaringFileName = surfaceInput.arkanalyzerDeclaringFileName || modulePath;
    const arkanalyzerDeclaringClassName = surfaceInput.arkanalyzerDeclaringClassName || ownerName;
    const canonicalApiId = canonicalApiIdFromProjectDeclaration({
        domain: "local",
        modulePath,
        ownerName,
        ownerKind,
        memberName: methodName,
        memberKind,
        invokeKind,
        parameterTypes,
        returnType,
    });
    return {
        surfaceId: `surface.${assetId}.${ruleId}.${index}`,
        canonicalApiId,
        kind: "invoke",
        evidence: {
            arkanalyzer: {
                methodKey: {
                    declaringFileName: arkanalyzerDeclaringFileName,
                    declaringNamespacePath: [],
                    declaringClassName: arkanalyzerDeclaringClassName,
                    methodName: surfaceInput.arkanalyzerMethodName || methodName,
                    parameterTypes,
                    returnType,
                    staticFlag: surfaceInput.arkanalyzerStaticFlag ?? (invokeKind === "static" || invokeKind === "free-function" || invokeKind === "namespace"),
                },
            },
        },
        confidence: "certain",
        provenance: { source: "manual" },
    };
}

function canonicalApiIdFromProjectDeclaration(input: {
    domain: "local";
    modulePath: string;
    ownerName: string;
    ownerKind: "namespace" | "class";
    memberKind: "function" | "method" | "property";
    memberName: string;
    invokeKind: "instance" | "static" | "namespace" | "free-function" | "property-read";
    parameterTypes: string[];
    returnType: string;
}): string {
    const file = logicalDeclarationFile(input.modulePath);
    const exportKind = input.memberKind === "function" && input.ownerName === "file" ? "default" : "namespace";
    const exportName = input.memberKind === "function" && input.ownerName === "file" ? "file" : input.ownerName;
    const result = fromProjectDeclaration({
        domain: input.domain,
        moduleSpecifier: input.modulePath,
        logicalDeclarationFile: file,
        exportPath: [{ kind: exportKind, name: exportName }],
        declarationOwner: {
            kind: input.ownerKind,
            path: [input.ownerName],
            normalizedName: input.ownerName,
            arkanalyzerName: input.ownerName,
        },
        member: input.memberKind === "method"
            ? { kind: "method", name: input.memberName, static: input.invokeKind === "static" }
            : { kind: input.memberKind, name: input.memberName },
        invoke: { kind: input.invokeKind === "property-read" ? "property-read" : "call" },
        signature: {
            parameters: input.parameterTypes.map((type, index) => ({ index, type: { text: type } })),
            returnType: { text: input.returnType },
        },
        arkanalyzer: input.memberKind === "property" ? undefined : {
            declaringFileName: file,
            declaringNamespacePath: [],
            declaringClassName: input.ownerName,
            methodName: input.memberName,
            parameterTypes: input.parameterTypes,
            returnType: input.returnType,
            staticFlag: input.invokeKind === "static" || input.invokeKind === "namespace" || input.invokeKind === "free-function",
        },
        declarationLocations: [{ file }],
    });
    if (result.status !== "accepted") {
        throw new Error(`fixture canonical identity rejected for ${input.ownerName}.${input.memberName}: ${result.reason}`);
    }
    return result.descriptor.canonicalApiId;
}

function logicalDeclarationFile(modulePath: string): string {
    return String(modulePath || "")
        .replace(/\\/g, "/")
        .replace(/^@/, "")
        .replace(/:\s*$/, "")
        .replace(/^\/+|\/+$/g, "")
        .trim()
        || "tests/fixtures/test_fixture.ts";
}

function modulePathFromSurface(assetId: string, surface: FixtureRuleSurface): string {
    return surface.modulePath
        || surface.calleeScope?.module?.value
        || surface.scope?.module?.value
        || surface.calleeScope?.file?.value
        || surface.scope?.file?.value
        || `tests/fixtures/${assetId}.ts`;
}

function invokeKindFromSurface(surface: FixtureRuleSurface): FixtureInvokeSurfaceKind {
    if (surface.kind === "access") return surface.invokeKind || (surface.receiverKind === "instance" ? "instance" : "static");
    if (surface.invokeKind) return surface.invokeKind;
    const ownerName = surface.ownerName
        || surface.calleeScope?.className?.value
        || surface.calleeClass?.value
        || surface.typeHint;
    return ownerName ? "instance" : "free-function";
}

function ownerNameFromSurface(surface: FixtureRuleSurface, invokeKind: FixtureInvokeSurfaceKind): string {
    const ownerName = surface.ownerName
        || surface.calleeScope?.className?.value
        || surface.scope?.className?.value
        || surface.calleeClass?.value
        || surface.typeHint;
    if (ownerName) return ownerName;
    return invokeKind === "free-function" || invokeKind === "namespace" ? "file" : "RuleAssetFixture";
}

function exactParameterTypesForSurface(surface: FixtureRuleSurface, argCount: number): string[] {
    const explicit = parameterTypesFromSurface(surface);
    if (explicit) return explicit;
    const parsed = parseParameterTypesFromSyntheticSignature(surface.kind === "signature" ? surface.signatureId : undefined, argCount);
    if (parsed) return parsed;
    return Array.from({ length: argCount }, (_unused, index) => `SyntheticArg${index}`);
}

function parameterTypesFromSurface(surface: FixtureRuleSurface): string[] | undefined {
    return Array.isArray(surface.parameterTypes) ? [...surface.parameterTypes] : undefined;
}

function parseParameterTypesFromSyntheticSignature(signatureId: unknown, argCount: number): string[] | undefined {
    const signature = String(signatureId || "");
    const open = signature.lastIndexOf("(");
    const close = signature.lastIndexOf(")");
    if (open < 0 || close <= open) return undefined;
    const body = signature.slice(open + 1, close).trim();
    const values = body.length === 0 ? [] : body.split(",").map(item => item.trim()).filter(Boolean);
    if (values.length !== argCount) return undefined;
    if (values.some(value => value.toLowerCase() === "unknown" || value.includes("%unk"))) return undefined;
    return values;
}

function returnTypeForFixtureSurface(
    role: "source" | "sink" | "sanitizer" | "transfer",
    template: NonNullable<AssetDocumentBase["effectTemplates"]>[number],
): string {
    if (role === "sink") return "void";
    if (role === "source") return usesReturnEndpoint((template as any).value) ? "SyntheticTaintValue" : "void";
    if (role === "sanitizer") return usesReturnEndpoint((template as any).value) ? "SyntheticTaintValue" : "void";
    if (role === "transfer") return usesReturnEndpoint((template as any).to) ? "SyntheticTaintValue" : "void";
    return "void";
}

function usesReturnEndpoint(value: unknown): boolean {
    if (!value || typeof value !== "object") return false;
    if (Array.isArray(value)) return value.some(usesReturnEndpoint);
    const endpoint = value as { base?: { kind?: string } };
    if (endpoint.base?.kind === "return" || endpoint.base?.kind === "promiseResult" || endpoint.base?.kind === "constructorResult") {
        return true;
    }
    return Object.values(value).some(usesReturnEndpoint);
}

function methodNameFromSurface(surface: FixtureRuleSurface): string {
    if (surface.kind === "invoke") return surface.methodName || surface.functionName || surface.memberName || "apply";
    if (surface.kind === "signature" && (surface.methodName || surface.functionName)) {
        return surface.methodName || surface.functionName || "apply";
    }
    const signature = surface.kind === "signature" ? surface.signatureId : "";
    const dotCall = /\.([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/.exec(signature);
    if (dotCall) return dotCall[1];
    const colonCall = /:\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/.exec(signature);
    if (colonCall) return colonCall[1];
    return surface.typeHint || signature.replace(/[^A-Za-z0-9_$]+/g, "_") || "apply";
}

function endpoint(input: RuleEndpointInput): RuleValueRef {
    if (!input) return { base: { kind: "return" } };
    if (typeof input !== "string") return input;
    if (input === "base") return { base: { kind: "receiver" } };
    if (input === "result") return { base: { kind: "return" } };
    if (input.startsWith("arg")) {
        const index = Number(input.slice("arg".length));
        return { base: { kind: "arg", index } };
    }
    return { base: { kind: "return" } };
}

function isAssetEndpoint(value: unknown): value is AssetEndpoint {
    return !!value
        && typeof value === "object"
        && !!(value as AssetEndpoint).base
        && typeof (value as AssetEndpoint).base === "object";
}
