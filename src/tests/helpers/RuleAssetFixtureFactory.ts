import type {
    AssetBindingMetadata,
    AssetDocumentBase,
    AssetEndpoint,
    RuntimeSelector,
    RuleValueRef,
} from "../../core/assets/schema";

type FixtureRuleMatch =
    | FixtureRuleMatchBase<"signature_contains">
    | FixtureRuleMatchBase<"signature_equals">
    | FixtureRuleMatchBase<"signature_regex">
    | FixtureRuleMatchBase<"declaring_class_equals">
    | FixtureRuleMatchBase<"method_name_equals">
    | FixtureRuleMatchBase<"method_name_regex">
    | FixtureRuleMatchBase<"local_name_regex">;

interface FixtureRuleMatchBase<K extends string> {
    kind: K;
    value: string;
    invokeKind?: RuntimeSelector["invokeKind"];
    argCount?: number;
    typeHint?: string;
    calleeClass?: RuntimeSelector["calleeClass"];
    scope?: RuntimeSelector["scope"];
    calleeScope?: RuntimeSelector["calleeScope"];
}

export interface SourceAssetFixtureRule {
    id: string;
    match: FixtureRuleMatch;
    sourceKind: "seed_local_name" | "entry_param" | "call_return" | "call_arg" | "field_read" | "callback_param" | "bound_state";
    target?: RuleEndpointInput;
    metadata?: AssetBindingMetadata;
}

export interface SinkAssetFixtureRule {
    id: string;
    match: FixtureRuleMatch;
    target?: RuleEndpointInput;
    metadata?: AssetBindingMetadata;
}

export interface SanitizerAssetFixtureRule {
    id: string;
    match: FixtureRuleMatch;
    target?: RuleEndpointInput;
    metadata?: AssetBindingMetadata;
}

export interface TransferAssetFixtureRule {
    id: string;
    match: FixtureRuleMatch;
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
        surfaces: hasRules
            ? [{
                surfaceId: `${assetId}.surface`,
                kind: "invoke",
                modulePath: "@arktaint/test-fixture",
                ownerName: "RuleAssetFixture",
                methodName: "apply",
                invokeKind: "static",
                argCount: 0,
                confidence: "certain",
                provenance: { source: "manual" },
            }]
            : [],
        bindings: [],
        effectTemplates: [],
        provenance: { source: "manual" },
    };

    sourceRules.forEach((rule, index) => {
        addRule(asset, "source", rule.id, rule.match, index, rule.metadata, {
            id: `template.${rule.id}`,
            kind: "rule.source",
            value: endpoint(rule.target || "result"),
            sourceKind: rule.sourceKind,
            confidence: "certain",
        });
    });
    sinkRules.forEach((rule, index) => {
        addRule(asset, "sink", rule.id, rule.match, index, rule.metadata, {
            id: `template.${rule.id}`,
            kind: "rule.sink",
            value: rule.target ? endpoint(rule.target) : undefined,
            sinkKind: "sink",
            confidence: "certain",
        });
    });
    sanitizerRules.forEach((rule, index) => {
        addRule(asset, "sanitizer", rule.id, rule.match, index, rule.metadata, {
            id: `template.${rule.id}`,
            kind: "rule.sanitizer",
            value: rule.target ? endpoint(rule.target) : undefined,
            sanitizerKind: "sanitizer",
            strength: "strong",
            confidence: "certain",
        });
    });
    transferRules.forEach((rule, index) => {
        addRule(asset, "transfer", rule.id, rule.match, index, rule.metadata, {
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
    match: FixtureRuleMatch,
    index: number,
    metadata: AssetBindingMetadata | undefined,
    template: NonNullable<AssetDocumentBase["effectTemplates"]>[number],
): void {
    const templateId = template.id;
    asset.effectTemplates = asset.effectTemplates || [];
    asset.effectTemplates.push(template);
    asset.bindings.push({
        bindingId: `binding.${ruleId}.${index}`,
        surfaceId: `${asset.id}.surface`,
        assetId: asset.id,
        plane: "rule",
        role,
        selector: selector(match),
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

function selector(match: FixtureRuleMatch): RuntimeSelector {
    const kindMap: Record<FixtureRuleMatch["kind"], RuntimeSelector["kind"]> = {
        signature_contains: "signature-contains",
        signature_equals: "signature-equals",
        signature_regex: "signature-regex",
        declaring_class_equals: "declaring-class-equals",
        method_name_equals: "method-name-equals",
        method_name_regex: "method-name-regex",
        local_name_regex: "local-name-regex",
    };
    return {
        kind: kindMap[match.kind],
        value: match.value,
        calleeClass: match.calleeClass,
        invokeKind: match.invokeKind,
        argCount: match.argCount,
        typeHint: match.typeHint,
        scope: match.scope,
        calleeScope: match.calleeScope,
    };
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
