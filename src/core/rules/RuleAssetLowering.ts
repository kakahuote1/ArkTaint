import type {
    AssetDocumentBase,
    AssetEndpoint,
    AssetBinding,
    EndpointSelectorRef,
    RuleSourceTemplate,
    RuleSinkTemplate,
    RuleSanitizerTemplate,
    RuleTransferTemplate,
    RuleValueRef,
    RuntimeSelector,
    RuntimeSelectorScope,
    SelectorStringConstraint,
    SemanticEffectTemplate,
} from "../assets/schema";
import { isTrustedAnalysisAssetStatus } from "../assets/schema";
import type {
    RuleEndpoint,
    RuleEndpointOrRef,
    RuleInvokeKind,
    RuleMatch,
    RuleScopeConstraint,
    RuleStringConstraint,
    SanitizerRule,
    SinkRule,
    SourceRule,
    TaintRuleSet,
    TransferRule,
} from "./RuleSchema";

type RuleTemplate = RuleSourceTemplate | RuleSinkTemplate | RuleSanitizerTemplate | RuleTransferTemplate;

export interface RuleAssetLoweringResult {
    ruleSet: TaintRuleSet;
    diagnostics: string[];
}

export function lowerRuleAssetsToRuleSet(
    assets: AssetDocumentBase[],
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
        if (!isAnalysisStatus(asset.status)) continue;
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
    const selector = binding.selector || selectorFromAssetSurface(asset, binding.surfaceId);
    if (!selector) {
        diagnostics.push(`${asset.id}:${binding.bindingId} has no runtime selector`);
        return;
    }
    const sourceCalleeScope = lowerScope(selector.calleeScope);
    const nonSourceCalleeScope = lowerScope(selector.calleeScope || selector.scope);
    const callerScope = lowerScope(selector.scope);
    const common = {
        id: lowerRuleId(binding, template),
        enabled: binding.metadata?.enabled !== false,
        description: binding.metadata?.description,
        tags: binding.metadata?.tags,
        layer: binding.metadata?.layer,
        family: binding.metadata?.family,
        tier: binding.metadata?.tier,
        match: lowerSelector(selector),
        category: binding.metadata?.category || binding.semanticsFamily,
        severity: binding.metadata?.severity,
    };

    switch (template.kind) {
        case "rule.source":
            ruleSet.sources.push({
                ...common,
                scope: callerScope,
                sourceKind: template.sourceKind as SourceRule["sourceKind"],
                target: lowerRuleValueRef(template.value),
                calleeScope: sourceCalleeScope,
            });
            return;
        case "rule.sink":
            ruleSet.sinks.push({
                ...common,
                scope: nonSourceCalleeScope,
                target: lowerOptionalRuleValueRef(template.value, binding.endpoint),
            });
            return;
        case "rule.sanitizer":
            ruleSet.sanitizers = ruleSet.sanitizers || [];
            ruleSet.sanitizers.push({
                ...common,
                scope: nonSourceCalleeScope,
                target: lowerOptionalRuleValueRef(template.value, binding.endpoint),
            });
            return;
        case "rule.transfer":
            ruleSet.transfers.push({
                ...common,
                scope: nonSourceCalleeScope,
                from: lowerRuleValueRef(template.from),
                to: lowerRuleValueRef(template.to),
            });
            return;
    }
}

function lowerRuleId(binding: AssetBinding, template: RuleTemplate): string {
    if (template.id.startsWith("template.")) {
        return template.id.slice("template.".length);
    }
    if (binding.bindingId.startsWith("binding.")) {
        return binding.bindingId.replace(/^binding\./, "").replace(/\.\d+$/, "");
    }
    return `${binding.bindingId}:${template.id}`;
}

function isRuleTemplate(template: SemanticEffectTemplate): template is RuleTemplate {
    return template.kind === "rule.source"
        || template.kind === "rule.sink"
        || template.kind === "rule.sanitizer"
        || template.kind === "rule.transfer";
}

function isAnalysisStatus(status: AssetDocumentBase["status"]): boolean {
    return isTrustedAnalysisAssetStatus(status);
}

function selectorFromAssetSurface(asset: AssetDocumentBase, surfaceId: string): RuntimeSelector | undefined {
    const surface = (asset.surfaces || []).find(item => item.surfaceId === surfaceId);
    if (!surface || surface.kind !== "invoke") return undefined;
    if (surface.methodName) {
        return {
            kind: "method-name-equals",
            value: surface.methodName,
            invokeKind: toRuntimeInvokeKind(surface.invokeKind),
            argCount: surface.argCount,
            typeHint: surface.ownerName,
            calleeScope: surface.ownerName
                ? { className: { mode: "equals", value: surface.ownerName } }
                : undefined,
        };
    }
    if (surface.functionName) {
        return {
            kind: "method-name-equals",
            value: surface.functionName,
            invokeKind: toRuntimeInvokeKind(surface.invokeKind),
            argCount: surface.argCount,
        };
    }
    return undefined;
}

function lowerSelector(selector: RuntimeSelector): RuleMatch {
    const kindMap: Record<RuntimeSelector["kind"], RuleMatch["kind"]> = {
        "signature-contains": "signature_contains",
        "signature-equals": "signature_equals",
        "signature-regex": "signature_regex",
        "declaring-class-equals": "declaring_class_equals",
        "method-name-equals": "method_name_equals",
        "method-name-regex": "method_name_regex",
        "local-name-regex": "local_name_regex",
    };
    return {
        kind: kindMap[selector.kind],
        value: selector.value,
        calleeClass: lowerStringConstraint(selector.calleeClass),
        invokeKind: selector.invokeKind ? lowerInvokeKind(selector.invokeKind) : undefined,
        argCount: selector.argCount,
        typeHint: selector.typeHint,
    };
}

function lowerRuleValueRef(ref: RuleValueRef): RuleEndpointOrRef {
    if (isEndpointSelectorRef(ref)) {
        const endpoint = lowerAssetEndpoint(ref.endpoint);
        if (typeof endpoint !== "object" && !ref.pathFrom && !ref.slotKind) {
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
    switch (base.kind) {
        case "receiver":
            lowered = "base";
            break;
        case "return":
        case "promiseResult":
        case "constructorResult":
            lowered = "result";
            break;
        case "arg":
            lowered = `arg${base.index}` as RuleEndpoint;
            break;
        case "callbackArg":
            lowered = `arg${base.argIndex}` as RuleEndpoint;
            break;
        case "callbackReturn":
            lowered = "result";
            break;
        default:
            lowered = "result";
    }
    if (endpoint.accessPath && endpoint.accessPath.length > 0) {
        return {
            endpoint: lowered,
            path: [...endpoint.accessPath],
        };
    }
    return lowered;
}

function isEndpointSelectorRef(ref: RuleValueRef): ref is EndpointSelectorRef {
    return typeof (ref as EndpointSelectorRef).endpoint === "object";
}

function lowerScope(scope: RuntimeSelectorScope | undefined): RuleScopeConstraint | undefined {
    if (!scope) return undefined;
    return {
        file: lowerStringConstraint(scope.file),
        module: lowerStringConstraint(scope.module),
        className: lowerStringConstraint(scope.className),
        methodName: lowerStringConstraint(scope.methodName),
    };
}

function lowerStringConstraint(value: SelectorStringConstraint | undefined): RuleStringConstraint | undefined {
    if (!value) return undefined;
    return {
        mode: value.mode,
        value: value.value,
    };
}

function lowerInvokeKind(kind: RuntimeSelector["invokeKind"]): RuleInvokeKind | undefined {
    if (!kind) return undefined;
    return kind;
}

function toRuntimeInvokeKind(kind: string): RuntimeSelector["invokeKind"] {
    if (kind === "instance" || kind === "static") return kind;
    return "any";
}
