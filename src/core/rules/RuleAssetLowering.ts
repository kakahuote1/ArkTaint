import type {
    AnalysisAssetLoadMode,
    AssetDocumentBase,
    AssetEndpoint,
    AssetBinding,
    EndpointSelectorRef,
    RuleSourceTemplate,
    RuleSinkTemplate,
    RuleSanitizerTemplate,
    RuleTransferTemplate,
    RuleValueRef,
    SemanticEffectTemplate,
} from "../assets/schema";
import { isAnalysisLoadableAssetStatus } from "../assets/schema";
import type {
    RuleEndpoint,
    RuleEndpointRef,
    RuleEndpointOrRef,
    RuleMatch,
    SanitizerRule,
    SinkRule,
    SourceRule,
    TaintRuleSet,
    TransferRule,
} from "./RuleSchema";
import type { ApiEffectIdentity, ApiEffectRole } from "../api/ApiOccurrenceIdentity";

type RuleTemplate = RuleSourceTemplate | RuleSinkTemplate | RuleSanitizerTemplate | RuleTransferTemplate;

interface RuntimeApiGate {
    kind: "canonical-api-id-equals";
    value: string;
}

export interface RuleAssetLoweringResult {
    ruleSet: TaintRuleSet;
    diagnostics: string[];
}

export interface RuleAssetLoweringOptions {
    loadMode?: AnalysisAssetLoadMode;
}

export function lowerRuleAssetsToRuleSet(
    assets: AssetDocumentBase[],
    options: RuleAssetLoweringOptions = {},
): RuleAssetLoweringResult {
    const diagnostics: string[] = [];
    const ruleSet: TaintRuleSet = {
        sources: [],
        sinks: [],
        sanitizers: [],
        transfers: [],
    };

    for (const asset of assets) {
        if (asset.plane !== "rule") continue;
        if (!isAnalysisStatus(asset.status, options.loadMode)) continue;
        const templates = new Map((asset.effectTemplates || []).map(template => [template.id, template]));
        for (const binding of asset.bindings || []) {
            if (binding.plane !== "rule") continue;
            const refs = binding.effectTemplateRefs || [];
            for (const ref of refs) {
                const template = templates.get(ref);
                if (!template) {
                    diagnostics.push(`${asset.id}:${binding.bindingId} references missing template ${ref}`);
                    continue;
                }
                lowerBindingTemplate(asset, binding, template, ruleSet, diagnostics);
            }
        }
    }

    return { ruleSet, diagnostics };
}

function lowerBindingTemplate(
    asset: AssetDocumentBase,
    binding: AssetBinding,
    template: SemanticEffectTemplate,
    ruleSet: TaintRuleSet,
    diagnostics: string[],
): void {
    if (!isRuleTemplate(template)) return;
    const apiGate = resolveBindingApiGate(asset, binding);
    if (!apiGate) {
        diagnostics.push(`${asset.id}:${binding.bindingId} has no executable API gate`);
        return;
    }
    const common = {
        id: lowerRuleId(binding, template),
        enabled: binding.metadata?.enabled !== false,
        description: binding.metadata?.description,
        tags: binding.metadata?.tags,
        family: binding.metadata?.family || binding.semanticsFamily,
        match: lowerApiGate(apiGate),
        category: binding.metadata?.category || binding.semanticsFamily,
        severity: binding.metadata?.severity,
        apiEffect: buildApiEffectIdentity(asset, binding, template),
    };

    switch (template.kind) {
        case "rule.source":
            ruleSet.sources.push({
                ...common,
                sourceKind: template.sourceKind as SourceRule["sourceKind"],
                target: lowerRuleValueRef(template.value),
            });
            return;
        case "rule.sink":
            ruleSet.sinks.push({
                ...common,
                target: lowerOptionalRuleValueRef(template.value, binding.endpoint),
            });
            return;
        case "rule.sanitizer":
            ruleSet.sanitizers = ruleSet.sanitizers || [];
            ruleSet.sanitizers.push({
                ...common,
                target: lowerOptionalRuleValueRef(template.value, binding.endpoint),
            });
            return;
        case "rule.transfer":
            ruleSet.transfers.push({
                ...common,
                from: lowerRuleValueRef(template.from),
                to: lowerRuleValueRef(template.to),
            });
            return;
    }
}

function lowerRuleId(binding: AssetBinding, template: RuleTemplate): string {
    if (
        (template.kind === "rule.sink" || template.kind === "rule.sanitizer") &&
        (template as RuleSinkTemplate | RuleSanitizerTemplate).value === undefined &&
        binding.endpoint !== undefined &&
        binding.bindingId.startsWith("binding.")
    ) {
        return binding.bindingId.replace(/^binding\./, "").replace(/\.\d+$/, "");
    }
    if (template.id.startsWith("template.")) {
        return template.id.slice("template.".length);
    }
    if (binding.bindingId.startsWith("binding.")) {
        return binding.bindingId.replace(/^binding\./, "").replace(/\.\d+$/, "");
    }
    return `${binding.bindingId}:${template.id}`;
}

function buildApiEffectIdentity(
    asset: AssetDocumentBase,
    binding: AssetBinding,
    template: SemanticEffectTemplate,
): ApiEffectIdentity {
    const surface = (asset.surfaces || []).find(item => item.surfaceId === binding.surfaceId);
    if (!surface) {
        throw new Error(`${asset.id}:${binding.bindingId} references missing surface ${binding.surfaceId}`);
    }
    if (!binding.canonicalApiId || binding.canonicalApiId !== surface.canonicalApiId) {
        throw new Error(`${asset.id}:${binding.bindingId} canonicalApiId must exactly match surface ${binding.surfaceId}`);
    }
    return {
        canonicalApiId: binding.canonicalApiId,
        assetId: binding.assetId,
        surfaceId: binding.surfaceId,
        bindingId: binding.bindingId,
        effectTemplateId: template.id,
        role: apiEffectRoleFromBinding(binding),
    };
}

function apiEffectRoleFromBinding(binding: AssetBinding): ApiEffectRole {
    const role = binding.role;
    if (
        role === "source"
        || role === "sink"
        || role === "sanitizer"
        || role === "transfer"
    ) {
        return role;
    }
    if (role === "entry") return "arkmain";
    if (role === "handoff" || role === "callback-registration") return "module";
    throw new Error(`${binding.bindingId} has unsupported API effect role ${String(role)}`);
}

function isRuleTemplate(template: SemanticEffectTemplate): template is RuleTemplate {
    return template.kind === "rule.source"
        || template.kind === "rule.sink"
        || template.kind === "rule.sanitizer"
        || template.kind === "rule.transfer";
}

function isAnalysisStatus(
    status: AssetDocumentBase["status"],
    loadMode: AnalysisAssetLoadMode = "trusted-analysis",
): boolean {
    return isAnalysisLoadableAssetStatus(status, loadMode);
}

function resolveBindingApiGate(asset: AssetDocumentBase, binding: AssetBinding): RuntimeApiGate | undefined {
    return apiGateFromAssetSurface(asset, binding.surfaceId, binding.role, binding);
}

function apiGateFromAssetSurface(
    asset: AssetDocumentBase,
    surfaceId: string,
    role?: AssetBinding["role"],
    binding?: AssetBinding,
): RuntimeApiGate | undefined {
    void role;
    const surface = (asset.surfaces || []).find(item => item.surfaceId === surfaceId);
    if (!surface) return undefined;
    const canonicalApiId = stableApiGateText(binding?.canonicalApiId);
    if (!canonicalApiId || canonicalApiId !== surface.canonicalApiId) {
        return undefined;
    }
    return {
        kind: "canonical-api-id-equals",
        value: canonicalApiId,
    };
}

function stableApiGateText(value: unknown): string | undefined {
    const text = String(value || "").trim();
    return text.length > 0 && !text.includes("%unk") && !text.includes("@unk") ? text : undefined;
}

function lowerApiGate(apiGate: RuntimeApiGate): RuleMatch {
    return {
        kind: "canonical_api_id_equals",
        value: apiGate.value,
    };
}

function lowerRuleValueRef(ref: RuleValueRef): RuleEndpointOrRef {
    if (isEndpointSelectorRef(ref)) {
        const endpoint = lowerAssetEndpoint(ref.endpoint);
        if (typeof endpoint !== "object" && !ref.pathFrom && !ref.slotKind && !ref.slotWriteMode && !ref.taintScope) {
            return endpoint;
        }
        const out = typeof endpoint === "object" ? { ...endpoint } : { endpoint };
        if (ref.pathFrom) {
            const from = lowerAssetEndpoint(ref.pathFrom);
            if (typeof from === "string") {
                out.pathFrom = from;
            } else {
                out.pathFrom = from.endpoint;
            }
        }
        if (ref.slotKind) {
            out.slotKind = ref.slotKind;
        }
        if (ref.slotWriteMode) {
            out.slotWriteMode = ref.slotWriteMode;
        }
        if (ref.taintScope) {
            out.taintScope = ref.taintScope;
        }
        return out;
    }
    return lowerAssetEndpoint(ref);
}

function lowerOptionalRuleValueRef(
    templateValue: RuleValueRef | undefined,
    bindingEndpoint: AssetEndpoint | undefined,
): RuleEndpointOrRef | undefined {
    if (templateValue) return lowerRuleValueRef(templateValue);
    if (bindingEndpoint) return lowerAssetEndpoint(bindingEndpoint);
    return undefined;
}

function lowerAssetEndpoint(endpoint: AssetEndpoint): RuleEndpointOrRef {
    const base = endpoint.base;
    let lowered: RuleEndpoint;
    let semanticEndpointKind: RuleEndpointRef["semanticEndpointKind"];
    switch (base.kind) {
        case "receiver":
            lowered = "base";
            break;
        case "return":
            lowered = "result";
            break;
        case "promiseResult":
            semanticEndpointKind = "promiseResult";
            lowered = "result";
            break;
        case "promiseRejected":
            semanticEndpointKind = "promiseRejected";
            lowered = "result";
            break;
        case "constructorResult":
            semanticEndpointKind = "constructorResult";
            lowered = "result";
            break;
        case "arg":
            lowered = `arg${base.index}` as RuleEndpoint;
            break;
        case "rest":
            semanticEndpointKind = "rest";
            lowered = `arg${base.startIndex}` as RuleEndpoint;
            break;
        case "callbackArg":
            lowered = `arg${base.argIndex}` as RuleEndpoint;
            break;
        case "callbackReturn":
            semanticEndpointKind = "callbackReturn";
            lowered = "result";
            break;
        default:
            lowered = "result";
    }
    if ((endpoint.accessPath && endpoint.accessPath.length > 0) || semanticEndpointKind || endpoint.taintScope) {
        return {
            endpoint: lowered,
            path: endpoint.accessPath && endpoint.accessPath.length > 0 ? [...endpoint.accessPath] : undefined,
            taintScope: endpoint.taintScope,
            semanticEndpointKind,
        };
    }
    return lowered;
}

function isEndpointSelectorRef(ref: RuleValueRef): ref is EndpointSelectorRef {
    return typeof (ref as EndpointSelectorRef).endpoint === "object";
}
