import type {
    AnalysisAssetLoadMode,
    AssetDocumentBase,
    AssetEndpoint,
    CallbackLocator,
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
import { isAnalysisLoadableAssetStatus } from "../assets/schema";
import type {
    RuleEndpoint,
    RuleEndpointRef,
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
    const selector = resolveBindingSelector(asset, binding);
    if (!selector) {
        diagnostics.push(`${asset.id}:${binding.bindingId} has no runtime selector`);
        return;
    }
    const sourceCalleeScope = lowerScope(selector.calleeScope);
    const nonSourceCalleeScope = lowerScope(selector.calleeScope);
    const callerScope = lowerScope(selector.scope);
    const transferScope = mergeScopes(callerScope, nonSourceCalleeScope);
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
                ...lowerSourceCallbackBinding(template.value, diagnostics, asset.id, binding.bindingId),
                scope: callerScope,
                sourceKind: template.sourceKind as SourceRule["sourceKind"],
                target: lowerRuleValueRef(template.value),
                calleeScope: sourceCalleeScope,
            });
            return;
        case "rule.sink":
            ruleSet.sinks.push({
                ...common,
                scope: callerScope,
                calleeScope: nonSourceCalleeScope,
                target: lowerOptionalRuleValueRef(template.value, binding.endpoint),
            });
            return;
        case "rule.sanitizer":
            ruleSet.sanitizers = ruleSet.sanitizers || [];
            ruleSet.sanitizers.push({
                ...common,
                scope: callerScope,
                calleeScope: nonSourceCalleeScope,
                target: lowerOptionalRuleValueRef(template.value, binding.endpoint),
            });
            return;
        case "rule.transfer":
            ruleSet.transfers.push({
                ...common,
                scope: transferScope,
                from: lowerRuleValueRef(template.from),
                to: lowerRuleValueRef(template.to),
            });
            return;
    }
}

function lowerSourceCallbackBinding(
    value: RuleValueRef,
    diagnostics: string[],
    assetId: string,
    bindingId: string,
): Pick<SourceRule, "callbackArgIndexes" | "callbackFieldNames" | "callbackResolution"> {
    const endpoint = endpointFromRuleValueRef(value);
    if (!endpoint || endpoint.base.kind !== "callbackArg") {
        return {};
    }
    const lowered = lowerCallbackLocator(endpoint.base.callback);
    if (!lowered) {
        diagnostics.push(`${assetId}:${bindingId} has unsupported callback locator for callback source`);
        return {};
    }
    return lowered;
}

function endpointFromRuleValueRef(value: RuleValueRef): AssetEndpoint | undefined {
    if (isEndpointSelectorRef(value)) {
        return value.endpoint;
    }
    return value;
}

function lowerCallbackLocator(
    locator: CallbackLocator,
): Pick<SourceRule, "callbackArgIndexes" | "callbackFieldNames" | "callbackResolution"> | undefined {
    if (locator.kind === "arg") {
        return {
            callbackArgIndexes: [locator.index],
            callbackResolution: "direct_arg",
        };
    }
    if (locator.kind === "option") {
        const base = locator.base?.base;
        if (base?.kind !== "arg") {
            return undefined;
        }
        const callbackFieldName = locator.accessPath?.[locator.accessPath.length - 1];
        if (!callbackFieldName) {
            return undefined;
        }
        return {
            callbackArgIndexes: [base.index],
            callbackFieldNames: [callbackFieldName],
            callbackResolution: "known_option",
        };
    }
    return undefined;
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

function resolveBindingSelector(asset: AssetDocumentBase, binding: AssetBinding): RuntimeSelector | undefined {
    const surfaceSelector = selectorFromAssetSurface(asset, binding.surfaceId, binding.role);
    if (!binding.selector) return surfaceSelector;
    if (!surfaceSelector) return binding.selector;
    if (!canMergeSelectorIdentity(binding.selector, surfaceSelector)) {
        return binding.selector;
    }
    return mergeSelectorIdentity(binding.selector, surfaceSelector);
}

function canMergeSelectorIdentity(
    selector: RuntimeSelector,
    surfaceSelector: RuntimeSelector,
): boolean {
    if (selector.kind === "method-name-equals" && surfaceSelector.kind === "method-name-equals") {
        return selector.value === surfaceSelector.value;
    }
    return false;
}

function mergeSelectorIdentity(
    selector: RuntimeSelector,
    surfaceSelector: RuntimeSelector,
): RuntimeSelector {
    const selectorInvokeKind = selector.invokeKind && selector.invokeKind !== "any"
        ? selector.invokeKind
        : undefined;
    return {
        ...selector,
        calleeClass: selector.calleeClass || surfaceSelector.calleeClass,
        invokeKind: selectorInvokeKind || surfaceSelector.invokeKind,
        argCount: selector.argCount ?? surfaceSelector.argCount,
        typeHint: selector.typeHint || surfaceSelector.typeHint,
        scope: selector.scope || surfaceSelector.scope,
        calleeScope: selector.calleeScope || surfaceSelector.calleeScope,
    };
}

function selectorFromAssetSurface(
    asset: AssetDocumentBase,
    surfaceId: string,
    role?: AssetBinding["role"],
): RuntimeSelector | undefined {
    const surface = (asset.surfaces || []).find(item => item.surfaceId === surfaceId);
    if (!surface) return undefined;
    if (surface.kind === "construct") {
        return {
            kind: "method-name-equals",
            value: surface.className,
            invokeKind: "any",
            argCount: surface.argCount,
            typeHint: surface.className,
            calleeScope: {
                className: { mode: "equals", value: surface.className },
            },
        };
    }
    if (surface.kind === "access") {
        return {
            kind: "field-name-equals",
            value: surface.propertyName,
            invokeKind: "any",
            typeHint: surface.ownerName,
            calleeScope: {
                className: { mode: "equals", value: surface.ownerName },
                methodName: { mode: "equals", value: surface.propertyName },
            },
        };
    }
    if (surface.kind !== "invoke") return undefined;
    if (role === "source") {
        const callerBackedFreeFunctionSelector = selectorFromCallerBackedFreeFunctionSurface(asset, surface, role);
        if (callerBackedFreeFunctionSelector) {
            return callerBackedFreeFunctionSelector;
        }
    }
    const freeFunctionSelector = selectorFromSourceBackedFreeFunctionSurface(asset, surface, role);
    if (freeFunctionSelector) {
        return freeFunctionSelector;
    }
    if (surface.methodName) {
        const calleeScope = calleeScopeFromInvokeSurface(asset, surface);
        if (isRuntimeSelectorPlaceholderSurface(surface)) {
            return {
                kind: "method-name-equals",
                value: surface.methodName,
                invokeKind: runtimeInvokeKindFromInvokeSurface(surface, role),
                argCount: runtimeArgCountFromInvokeSurface(asset, surface, role),
            };
        }
        return {
            kind: "method-name-equals",
            value: surface.methodName,
            invokeKind: runtimeInvokeKindFromInvokeSurface(surface, role),
            argCount: runtimeArgCountFromInvokeSurface(asset, surface, role),
            typeHint: surface.ownerName,
            calleeScope,
        };
    }
    if (surface.functionName) {
        return {
            kind: "method-name-equals",
            value: surface.functionName,
            invokeKind: runtimeInvokeKindFromInvokeSurface(surface, role),
            argCount: runtimeArgCountFromInvokeSurface(asset, surface, role),
            typeHint: surface.functionName,
            calleeScope: calleeScopeFromFreeFunctionSurface(surface),
        };
    }
    return undefined;
}

function isRuntimeSelectorPlaceholderSurface(surface: any): boolean {
    return surface?.modulePath === "@arktaint/runtime-selector"
        && surface?.ownerName === "RuntimeSelector";
}

function calleeScopeFromFreeFunctionSurface(surface: any): RuntimeSelectorScope | undefined {
    const moduleText = runtimeModuleTextFromSurfaceModulePath(stableSelectorText(surface.modulePath));
    if (!moduleText) return undefined;
    return {
        module: {
            mode: "contains",
            value: moduleText.replace(/\\/g, "/"),
        },
    };
}

function runtimeModuleTextFromSurfaceModulePath(modulePath: string | undefined): string | undefined {
    const raw = stableSelectorText(modulePath);
    if (!raw) return undefined;
    const normalized = raw.replace(/\\/g, "/");
    if (normalized.startsWith("api/@") && normalized.endsWith(".d.ts")) {
        return normalized.slice("api/".length, -".d.ts".length);
    }
    return normalized;
}

function runtimeArgCountFromInvokeSurface(
    asset: AssetDocumentBase,
    surface: any,
    role?: AssetBinding["role"],
): number | undefined {
    if (isSemanticFlowGeneratedProjectAsset(asset, surface) && (role === "source" || role === "sink" || role === "sanitizer")) {
        return undefined;
    }
    return surface.argCount;
}

function calleeScopeFromInvokeSurface(asset: AssetDocumentBase, surface: any): RuntimeSelectorScope | undefined {
    const scope: RuntimeSelectorScope = {};
    if (surface.ownerName) {
        scope.className = { mode: "equals", value: surface.ownerName };
    }
    if (isSemanticFlowGeneratedProjectAsset(asset, surface)) {
        const fileAnchor = normalizeSourceFileAnchor(stableSelectorText(surface.modulePath));
        if (fileAnchor && fileAnchor.endsWith(".ets")) {
            scope.file = { mode: "contains", value: fileAnchor };
        }
    }
    return Object.keys(scope).length > 0 ? scope : undefined;
}

function isSemanticFlowGeneratedProjectAsset(asset: AssetDocumentBase, surface: any): boolean {
    return asset.provenance?.source === "llm"
        && (asset.status === "schema-valid" || asset.status === "llm-generated" || asset.status === "candidate")
        && surface?.provenance?.source === "llm-proposal";
}

function selectorFromCallerBackedFreeFunctionSurface(
    asset: AssetDocumentBase,
    surface: any,
    role?: AssetBinding["role"],
): RuntimeSelector | undefined {
    if (surface.invokeKind !== "free-function") {
        return undefined;
    }
    const functionName = stableSelectorText(surface.functionName);
    if (!functionName) {
        return undefined;
    }
    const calleeFileAnchor = normalizeSourceFileAnchor(stableSelectorText(surface.modulePath));
    const callerFileAnchor = normalizeSourceFileAnchor(stableSelectorText(surface.provenance?.location?.file));
    if (!callerFileAnchor || !callerFileAnchor.endsWith(".ets")) {
        return undefined;
    }
    if (calleeFileAnchor && callerFileAnchor === calleeFileAnchor) {
        return undefined;
    }
        return {
            kind: "method-name-equals",
            value: functionName,
            invokeKind: runtimeInvokeKindFromInvokeSurface(surface, role),
            argCount: runtimeArgCountFromInvokeSurface(asset, surface, role),
            typeHint: functionName,
            scope: {
            file: {
                mode: "contains",
                value: callerFileAnchor,
            },
        },
    };
}

function selectorFromSourceBackedFreeFunctionSurface(
    asset: AssetDocumentBase,
    surface: any,
    role?: AssetBinding["role"],
): RuntimeSelector | undefined {
    if (surface.invokeKind !== "free-function") {
        return undefined;
    }
    const functionName = stableSelectorText(surface.functionName);
    if (!functionName) {
        return undefined;
    }
    const exactRuntimeSignature = runtimeMethodSignatureFromSurface(surface);
    if (exactRuntimeSignature) {
        return {
            kind: "signature-equals",
            value: exactRuntimeSignature,
            invokeKind: runtimeInvokeKindFromInvokeSurface(surface, role),
            argCount: runtimeArgCountFromInvokeSurface(asset, surface, role),
            typeHint: functionName,
        };
    }
    const fileAnchor = normalizeSourceFileAnchor(
        stableSelectorText(surface.modulePath)
            || stableSelectorText(surface.provenance?.location?.file)
    );
    if (!fileAnchor || !fileAnchor.endsWith(".ets")) {
        return undefined;
    }
        return {
            kind: "method-name-equals",
            value: functionName,
            invokeKind: runtimeInvokeKindFromInvokeSurface(surface, role),
            argCount: runtimeArgCountFromInvokeSurface(asset, surface, role),
            typeHint: functionName,
            calleeScope: {
            file: {
                mode: "contains",
                value: fileAnchor,
            },
        },
    };
}

function runtimeMethodSignatureFromSurface(surface: any): string | undefined {
    const signature = stableSelectorText(surface.signatureId);
    if (!signature) {
        return undefined;
    }
    return looksLikeRuntimeMethodSignature(signature) ? signature : undefined;
}

function looksLikeRuntimeMethodSignature(value: string): boolean {
    return value.includes(":")
        && value.includes(".")
        && value.includes("(")
        && value.includes(")");
}

function normalizeSourceFileAnchor(value: string | undefined): string | undefined {
    const normalized = String(value || "").replace(/\\/g, "/").replace(/^@/, "").trim();
    if (!normalized) {
        return undefined;
    }
    const etsIndex = normalized.indexOf("/ets/");
    if (etsIndex >= 0) {
        return normalized.slice(etsIndex + 1);
    }
    if (normalized.startsWith("ets/")) {
        return normalized;
    }
    return normalized;
}

function stableSelectorText(value: unknown): string | undefined {
    const text = String(value || "").trim();
    return text.length > 0 && !text.includes("%unk") && !text.includes("@unk") ? text : undefined;
}

function lowerSelector(selector: RuntimeSelector): RuleMatch {
    const kindMap: Record<RuntimeSelector["kind"], RuleMatch["kind"]> = {
        "signature-equals": "signature_equals",
        "declaring-class-equals": "declaring_class_equals",
        "method-name-equals": "method_name_equals",
        "field-name-equals": "field_name_equals",
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
        if (typeof endpoint !== "object" && !ref.pathFrom && !ref.slotKind && !ref.taintScope) {
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
        case "constructorResult":
            semanticEndpointKind = "constructorResult";
            lowered = "result";
            break;
        case "arg":
            lowered = `arg${base.index}` as RuleEndpoint;
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
    if ((endpoint.accessPath && endpoint.accessPath.length > 0) || semanticEndpointKind) {
        return {
            endpoint: lowered,
            path: endpoint.accessPath && endpoint.accessPath.length > 0 ? [...endpoint.accessPath] : undefined,
            semanticEndpointKind,
        };
    }
    return lowered;
}

function isEndpointSelectorRef(ref: RuleValueRef): ref is EndpointSelectorRef {
    return typeof (ref as EndpointSelectorRef).endpoint === "object";
}

function lowerScope(scope: RuntimeSelectorScope | undefined): RuleScopeConstraint | undefined {
    if (!scope) return undefined;
    const lowered: RuleScopeConstraint = {
        file: lowerStringConstraint(scope.file),
        module: lowerStringConstraint(scope.module),
        className: lowerStringConstraint(scope.className),
        methodName: lowerStringConstraint(scope.methodName),
        methodDecorators: scope.methodDecorators?.map(lowerStringConstraint).filter((item): item is RuleStringConstraint => !!item),
    };
    return Object.values(lowered).some(value => value !== undefined) ? lowered : undefined;
}

function mergeScopes(...scopes: Array<RuleScopeConstraint | undefined>): RuleScopeConstraint | undefined {
    const merged: RuleScopeConstraint = {};
    for (const scope of scopes) {
        if (!scope) continue;
        if (scope.file) merged.file = scope.file;
        if (scope.module) merged.module = scope.module;
        if (scope.className) merged.className = scope.className;
        if (scope.methodName) merged.methodName = scope.methodName;
        if (scope.methodDecorators && scope.methodDecorators.length > 0) {
            merged.methodDecorators = scope.methodDecorators;
        }
    }
    return Object.values(merged).some(value => value !== undefined) ? merged : undefined;
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
    if (kind === "free-function" || kind === "namespace") return "static";
    return "any";
}

function runtimeInvokeKindFromInvokeSurface(
    surface: any,
    role?: AssetBinding["role"],
): RuntimeSelector["invokeKind"] {
    if (
        role === "source"
        &&
        surface?.invokeKind === "free-function"
        && isOfficialSdkDeclarationModulePath(surface?.modulePath)
    ) {
        return "any";
    }
    return toRuntimeInvokeKind(surface?.invokeKind);
}

function isOfficialSdkDeclarationModulePath(modulePath: unknown): boolean {
    const normalized = stableSelectorText(modulePath)?.replace(/\\/g, "/") || "";
    return normalized.startsWith("api/@") && normalized.endsWith(".d.ts");
}
