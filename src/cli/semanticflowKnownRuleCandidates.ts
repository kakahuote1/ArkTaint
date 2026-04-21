import * as fs from "fs";
import * as path from "path";
import type {
    ModuleEndpoint,
    ModuleInvokeSurfaceSelector,
    ModuleSemantic,
    ModuleSemanticSurfaceRef,
    ModuleSpec,
    ModuleSpecDocument,
} from "../core/kernel/contracts/ModuleSpec";
import type { NormalizedCallsiteItem } from "../core/model/callsite/callsiteContextSlices";
import { semanticFlowDeclaringClassFromSignature } from "../core/semanticflow/SemanticFlowRuleCompanions";
import { loadRuleSet, type RuleLoaderOptions } from "../core/rules/RuleLoader";
import type {
    RuleMatch,
    RuleScopeConstraint,
    RuleStringConstraint,
    SanitizerRule,
    SinkRule,
    SourceRule,
    TransferRule,
} from "../core/rules/RuleSchema";
import { resolveModelSelections } from "./modelSelection";

interface CandidateView {
    item: NormalizedCallsiteItem;
    signatureText: string;
    signatureLower: string;
    ownerText: string;
    ownerLower: string;
    simpleOwnerLower: string;
    methodLower: string;
}

const HIGH_RISK_METHOD_NAMES = new Set(["get", "set", "update", "request", "on"]);

interface KnownMatcher {
    id: string;
    matches(view: CandidateView): boolean;
}

export interface FilterKnownSemanticFlowRuleCandidatesOptions {
    modelRoots?: string[];
    enabledModels?: string[];
    disabledModels?: string[];
}

export interface FilterKnownSemanticFlowRuleCandidatesResult {
    candidates: NormalizedCallsiteItem[];
    skippedKnown: NormalizedCallsiteItem[];
}

export function filterKnownSemanticFlowRuleCandidates(
    candidates: NormalizedCallsiteItem[],
    options: FilterKnownSemanticFlowRuleCandidatesOptions = {},
): FilterKnownSemanticFlowRuleCandidatesResult {
    if (candidates.length === 0) {
        return { candidates: [], skippedKnown: [] };
    }
    const resolved = resolveKnownSemanticFlowSelections(options);
    const matchers = [
        ...createKnownRuleMatchers(resolved.ruleOptions),
        ...createBuiltinMatchers(),
        ...createEnabledProjectModuleSpecMatchers(resolved.modelRoots, resolved.enabledModuleProjects),
    ];
    if (matchers.length === 0) {
        return { candidates: [...candidates], skippedKnown: [] };
    }
    const kept: NormalizedCallsiteItem[] = [];
    const skippedKnown: NormalizedCallsiteItem[] = [];
    for (const item of candidates) {
        const view = createCandidateView(item);
        if (matchers.some(matcher => matcher.matches(view))) {
            skippedKnown.push(item);
            continue;
        }
        kept.push(item);
    }
    return {
        candidates: kept,
        skippedKnown,
    };
}

function resolveKnownSemanticFlowSelections(
    options: FilterKnownSemanticFlowRuleCandidatesOptions,
): { modelRoots: string[]; enabledModuleProjects: string[]; ruleOptions: RuleLoaderOptions } {
    const modelRoots = [...new Set((options.modelRoots || []).map(item => path.resolve(item)).filter(Boolean))];
    const resolved = resolveModelSelections({
        ruleOptions: {
            autoDiscoverLayers: true,
            ruleCatalogPath: modelRoots[0],
            ruleCatalogPaths: modelRoots,
            enabledRulePacks: [],
            disabledRulePacks: [],
        } satisfies RuleLoaderOptions,
        modelRoots,
        enabledModels: options.enabledModels || [],
        disabledModels: options.disabledModels || [],
    });
    return {
        modelRoots,
        enabledModuleProjects: resolved.enabledModuleProjects,
        ruleOptions: resolved.ruleOptions,
    };
}

function createBuiltinMatchers(): KnownMatcher[] {
    const matchers: KnownMatcher[] = [];

    const storageClasses = ["AppStorage", "LocalStorage", "PersistentStorage"];
    const storageMethods = new Set(["set", "setorcreate", "persistprop", "get", "prop", "link"]);
    matchers.push({
        id: "builtin:harmony.appstorage",
        matches(view) {
            return storageMethods.has(view.methodLower) && storageClasses.some(name => matchesDeclaringClass(view, name));
        },
    });

    const routerMethods = new Set(["pushurl", "replaceurl", "pushnamedroute", "pushpath", "pushpathbyname", "replacepath", "getparams"]);
    matchers.push({
        id: "builtin:harmony.router",
        matches(view) {
            if (!routerMethods.has(view.methodLower)) return false;
            return containsAny(view.signatureLower, ["router", "navdestination", "ohos.router", "ohos/router"])
                || containsAny(view.ownerLower, ["router", "navdestination"]);
        },
    });

    const handoffMethods = new Set(["startability", "startabilityforresult", "connectserviceextensionability"]);
    matchers.push({
        id: "builtin:harmony.ability_handoff",
        matches(view) {
            if (!handoffMethods.has(view.methodLower)) return false;
            return containsAny(view.signatureLower, ["ability", "context", "extension"])
                || containsAny(view.ownerLower, ["ability", "context", "extension"]);
        },
    });

    matchers.push({
        id: "builtin:harmony.emitter",
        matches(view) {
            if (view.methodLower !== "on" && view.methodLower !== "emit") return false;
            return containsAny(view.signatureLower, ["emitter", "event"])
                || containsAny(view.ownerLower, ["emitter", "event"]);
        },
    });

    const workerTaskPoolMethods = new Set(["postmessage", "onmessage", "execute"]);
    matchers.push({
        id: "builtin:harmony.worker_taskpool",
        matches(view) {
            if (!workerTaskPoolMethods.has(view.methodLower)) return false;
            return containsAny(view.signatureLower, ["worker", "taskpool"])
                || containsAny(view.ownerLower, ["worker", "taskpool"]);
        },
    });

    const arrayMethods = new Set(["push", "pop", "shift", "unshift", "at", "concat", "splice", "slice", "map", "filter", "reduce", "foreach", "values", "entries", "keys"]);
    const mapMethods = new Set(["set", "get", "has", "entries", "values", "keys", "foreach"]);
    const setMethods = new Set(["add", "has", "entries", "values", "keys", "foreach"]);
    matchers.push({
        id: "builtin:tsjs.container.array",
        matches(view) {
            return arrayMethods.has(view.methodLower) && matchesDeclaringClass(view, "Array");
        },
    });
    matchers.push({
        id: "builtin:tsjs.container.map",
        matches(view) {
            return mapMethods.has(view.methodLower) && (matchesDeclaringClass(view, "Map") || matchesDeclaringClass(view, "WeakMap"));
        },
    });
    matchers.push({
        id: "builtin:tsjs.container.set",
        matches(view) {
            return setMethods.has(view.methodLower) && (matchesDeclaringClass(view, "Set") || matchesDeclaringClass(view, "WeakSet"));
        },
    });

    return matchers;
}

function createEnabledProjectModuleSpecMatchers(
    modelRoots: string[],
    enabledModuleProjects: string[],
): KnownMatcher[] {
    if (modelRoots.length === 0) {
        return [];
    }
    const specs = loadEnabledProjectModuleSpecs(modelRoots, enabledModuleProjects);
    return specs.flatMap(spec => createModuleSpecMatchers(spec, `project:${spec.id}`));
}

function createKnownRuleMatchers(ruleOptions: RuleLoaderOptions): KnownMatcher[] {
    const loaded = loadRuleSet({
        ...ruleOptions,
    });
    const matchers: KnownMatcher[] = [];
    for (const rule of loaded.ruleSet.sources || []) {
        if (rule.enabled === false) continue;
        if (!isCallLikeSourceRule(rule)) continue;
        const scope = rule.calleeScope || rule.scope;
        if (!isSpecificEnoughRuleForKnownCoverage(rule.match, rule.scope, rule.calleeScope)) continue;
        matchers.push(ruleMatcher(`rule:source:${rule.id}`, rule.match, scope));
    }
    for (const rule of loaded.ruleSet.sinks || []) {
        if (rule.enabled === false) continue;
        if (!isSpecificEnoughRuleForKnownCoverage(rule.match, rule.scope)) continue;
        matchers.push(ruleMatcher(`rule:sink:${rule.id}`, rule.match, rule.scope));
    }
    for (const rule of loaded.ruleSet.sanitizers || []) {
        if (rule.enabled === false) continue;
        if (!isSpecificEnoughRuleForKnownCoverage(rule.match, rule.scope)) continue;
        matchers.push(ruleMatcher(`rule:sanitizer:${rule.id}`, rule.match, rule.scope));
    }
    for (const rule of loaded.ruleSet.transfers || []) {
        if (rule.enabled === false) continue;
        if (!isSpecificEnoughRuleForKnownCoverage(rule.match, rule.scope)) continue;
        matchers.push(ruleMatcher(`rule:transfer:${rule.id}`, rule.match, rule.scope));
    }
    return matchers;
}

function isCallLikeSourceRule(rule: SourceRule): boolean {
    return rule.sourceKind === "call_return"
        || rule.sourceKind === "call_arg"
        || rule.sourceKind === "callback_param";
}

function isSpecificEnoughRuleForKnownCoverage(
    match: RuleMatch,
    scope?: RuleScopeConstraint,
    calleeScope?: RuleScopeConstraint,
): boolean {
    const anchoredByScope = hasAnyScopeAnchor(scope, calleeScope);
    const anchoredByClass = !!match.calleeClass;
    const anchoredByShape = hasShapeAnchor(match);
    if (match.kind === "signature_equals" || match.kind === "signature_contains" || match.kind === "signature_regex") {
        return true;
    }
    if (match.kind === "declaring_class_equals") {
        return true;
    }
    if (match.kind === "method_name_equals") {
        const methodName = lower(match.value);
        if (HIGH_RISK_METHOD_NAMES.has(methodName)) {
            return anchoredByScope || anchoredByClass;
        }
        return anchoredByScope || anchoredByClass || anchoredByShape;
    }
    if (match.kind === "method_name_regex") {
        return anchoredByScope || anchoredByClass || anchoredByShape;
    }
    return false;
}

function hasShapeAnchor(match: RuleMatch): boolean {
    return !!(
        (match.invokeKind && match.invokeKind !== "any")
        || match.argCount !== undefined
        || (typeof match.typeHint === "string" && match.typeHint.trim().length > 0)
    );
}

function hasAnyScopeAnchor(scope?: RuleScopeConstraint, calleeScope?: RuleScopeConstraint): boolean {
    return hasScopeAnchor(scope) || hasScopeAnchor(calleeScope);
}

function hasScopeAnchor(scope?: RuleScopeConstraint): boolean {
    if (!scope) return false;
    return !!(scope.file || scope.module || scope.className || scope.methodName);
}

function ruleMatcher(id: string, match: RuleMatch, scope: RuleScopeConstraint | undefined): KnownMatcher {
    return {
        id,
        matches(view) {
            return matchesRuleShape(view, match)
                && matchesRuleMatch(view, match)
                && matchesRuleScope(view, scope);
        },
    };
}

function loadEnabledProjectModuleSpecs(modelRoots: string[], enabledModuleProjects: string[]): ModuleSpec[] {
    const out: ModuleSpec[] = [];
    for (const projectId of enabledModuleProjects) {
        for (const modelRoot of modelRoots) {
            const modulesDir = path.join(modelRoot, "project", projectId, "modules");
            if (!fs.existsSync(modulesDir) || !fs.statSync(modulesDir).isDirectory()) {
                continue;
            }
            for (const entry of fs.readdirSync(modulesDir)) {
                if (!entry.toLowerCase().endsWith(".json")) continue;
                const absPath = path.join(modulesDir, entry);
                try {
                    const parsed = JSON.parse(fs.readFileSync(absPath, "utf-8"));
                    for (const spec of normalizeModuleSpecDocument(parsed)) {
                        out.push(spec);
                    }
                } catch {
                    continue;
                }
            }
        }
    }
    return out;
}

function normalizeModuleSpecDocument(parsed: unknown): ModuleSpec[] {
    if (!parsed || typeof parsed !== "object") {
        return [];
    }
    const doc = parsed as ModuleSpecDocument & { id?: string; semantics?: ModuleSemantic[] };
    if (Array.isArray(doc.modules)) {
        return doc.modules.filter(spec => !!spec && typeof spec.id === "string" && Array.isArray(spec.semantics));
    }
    if (typeof doc.id === "string" && Array.isArray(doc.semantics)) {
        return [doc as ModuleSpec];
    }
    return [];
}

function createModuleSpecMatchers(spec: ModuleSpec, prefix: string): KnownMatcher[] {
    const matchers: KnownMatcher[] = [];
    for (const semantic of spec.semantics || []) {
        switch (semantic.kind) {
            case "keyed_storage": {
                const storageClasses = (semantic.storageClasses || []).map(item => String(item));
                const writeMethods = (semantic.writeMethods || []).map(item => String(item?.methodName || ""));
                const readMethods = (semantic.readMethods || []).map(item => String(item));
                const methods = new Set([...writeMethods, ...readMethods].map(lower));
                if (storageClasses.length === 0 || methods.size === 0) break;
                matchers.push({
                    id: `${prefix}:keyed_storage`,
                    matches(view) {
                        return methods.has(view.methodLower) && storageClasses.some(name => matchesDeclaringClass(view, name));
                    },
                });
                break;
            }
            case "event_emitter": {
                const methods = new Set([
                    ...(semantic.onMethods || []).map(lower),
                    ...(semantic.emitMethods || []).map(lower),
                ]);
                if (methods.size === 0) break;
                matchers.push({
                    id: `${prefix}:event_emitter`,
                    matches(view) {
                        return methods.has(view.methodLower);
                    },
                });
                break;
            }
            case "route_bridge": {
                const methods = new Set([
                    ...(semantic.pushMethods || []).map(item => lower(item?.methodName)),
                    ...(semantic.getMethods || []).map(lower),
                ]);
                if (methods.size === 0) break;
                matchers.push({
                    id: `${prefix}:route_bridge`,
                    matches(view) {
                        return methods.has(view.methodLower);
                    },
                });
                break;
            }
            case "ability_handoff": {
                const methods = new Set((semantic.startMethods || []).map(lower));
                if (methods.size === 0) break;
                matchers.push({
                    id: `${prefix}:ability_handoff`,
                    matches(view) {
                        return methods.has(view.methodLower);
                    },
                });
                break;
            }
            case "bridge": {
                const surfaces = [
                    invokeSurfaceFromEndpoint(semantic.from),
                    invokeSurfaceFromEndpoint(semantic.to),
                ].filter((item): item is ModuleInvokeSurfaceSelector => !!item);
                for (const [index, selector] of surfaces.entries()) {
                    matchers.push(selectorMatcher(`${prefix}:bridge:${index}`, selector));
                }
                break;
            }
            case "state": {
                const surfaces = [
                    ...(semantic.writes || []).map(item => invokeSurfaceFromEndpoint(item.from)),
                    ...(semantic.reads || []).map(item => invokeSurfaceFromEndpoint(item.to)),
                ].filter((item): item is ModuleInvokeSurfaceSelector => !!item);
                for (const [index, selector] of surfaces.entries()) {
                    matchers.push(selectorMatcher(`${prefix}:state:${index}`, selector));
                }
                break;
            }
            case "declarative_binding": {
                const surfaces = [
                    invokeSurfaceFromSurfaceRef(semantic.source),
                    invokeSurfaceFromSurfaceRef(semantic.handler),
                ].filter((item): item is ModuleInvokeSurfaceSelector => !!item);
                for (const [index, selector] of surfaces.entries()) {
                    matchers.push(selectorMatcher(`${prefix}:declarative:${index}`, selector));
                }
                break;
            }
            default:
                break;
        }
    }
    return matchers;
}

function selectorMatcher(id: string, selector: ModuleInvokeSurfaceSelector): KnownMatcher {
    return {
        id,
        matches(view) {
            return matchesInvokeSelector(view, selector);
        },
    };
}

function invokeSurfaceFromEndpoint(endpoint: ModuleEndpoint | undefined): ModuleInvokeSurfaceSelector | undefined {
    if (!endpoint) return undefined;
    return invokeSurfaceFromSurfaceRef(endpoint.surface);
}

function invokeSurfaceFromSurfaceRef(surface: ModuleSemanticSurfaceRef | string | undefined): ModuleInvokeSurfaceSelector | undefined {
    if (!surface) return undefined;
    if (typeof surface === "string") {
        return { methodName: surface };
    }
    if (surface.kind !== "invoke") {
        return undefined;
    }
    return surface.selector || undefined;
}

function createCandidateView(item: NormalizedCallsiteItem): CandidateView {
    const signatureText = String(item.callee_signature || "");
    const ownerText = semanticFlowDeclaringClassFromSignature(signatureText) || "";
    return {
        item,
        signatureText,
        signatureLower: signatureText.toLowerCase(),
        ownerText,
        ownerLower: ownerText.toLowerCase(),
        simpleOwnerLower: extractSimpleClassName(ownerText).toLowerCase(),
        methodLower: lower(item.method),
    };
}

function matchesInvokeSelector(view: CandidateView, selector: ModuleInvokeSurfaceSelector): boolean {
    if (selector.methodName && lower(selector.methodName) !== view.methodLower) return false;
    if (selector.declaringClassName && !matchesDeclaringClass(view, selector.declaringClassName)) return false;
    if (selector.declaringClassIncludes && !view.ownerLower.includes(lower(selector.declaringClassIncludes))) return false;
    if (selector.signature && normalizeSpace(selector.signature) !== normalizeSpace(view.signatureText)) return false;
    if (selector.signatureIncludes && !view.signatureLower.includes(lower(selector.signatureIncludes))) return false;
    if (typeof selector.minArgs === "number" && view.item.argCount < selector.minArgs) return false;
    if (selector.instanceOnly && view.item.invokeKind === "static") return false;
    if (selector.staticOnly && view.item.invokeKind === "instance") return false;
    return true;
}

function matchesRuleShape(view: CandidateView, match: RuleMatch): boolean {
    if (match.invokeKind && match.invokeKind !== "any" && match.invokeKind !== view.item.invokeKind) return false;
    if (match.argCount !== undefined && match.argCount !== view.item.argCount) return false;
    if (match.typeHint && match.typeHint.trim().length > 0) {
        const hint = match.typeHint.trim().toLowerCase();
        const haystack = `${view.signatureText} ${view.ownerText}`.toLowerCase();
        if (!haystack.includes(hint)) return false;
    }
    if (match.calleeClass && !matchesClassConstraint(match.calleeClass, view.ownerText, extractSimpleClassName(view.ownerText))) return false;
    return true;
}

function matchesRuleMatch(view: CandidateView, match: RuleMatch): boolean {
    const value = String(match.value || "");
    switch (match.kind) {
        case "method_name_equals":
            return view.item.method === value;
        case "method_name_regex":
            try {
                return new RegExp(value).test(view.item.method);
            } catch {
                return false;
            }
        case "signature_contains":
            return view.signatureText.includes(value);
        case "signature_equals":
            return view.signatureText === value;
        case "signature_regex":
            try {
                return new RegExp(value).test(view.signatureText);
            } catch {
                return false;
            }
        case "declaring_class_equals":
            return view.ownerText === value || view.simpleOwnerLower === lower(value);
        default:
            return false;
    }
}

function matchesRuleScope(view: CandidateView, scope: RuleScopeConstraint | undefined): boolean {
    if (!scope) return true;
    if (!matchesStringConstraint(scope.file, view.item.sourceFile)) return false;
    if (!matchesStringConstraint(scope.module, view.signatureText || view.item.sourceFile)) return false;
    if (!matchesClassConstraint(scope.className, view.ownerText, extractSimpleClassName(view.ownerText))) return false;
    if (!matchesStringConstraint(scope.methodName, view.item.method)) return false;
    return true;
}

function matchesStringConstraint(constraint: RuleStringConstraint | undefined, text: string): boolean {
    if (!constraint) return true;
    if (constraint.mode === "equals") return text === constraint.value;
    if (constraint.mode === "contains") return text.includes(constraint.value);
    try {
        return new RegExp(constraint.value).test(text);
    } catch {
        return false;
    }
}

function matchesClassConstraint(
    constraint: RuleStringConstraint | undefined,
    ownerText: string,
    simpleOwnerText: string,
): boolean {
    if (!constraint) return true;
    return matchesStringConstraint(constraint, ownerText)
        || matchesStringConstraint(constraint, simpleOwnerText);
}

function matchesDeclaringClass(view: CandidateView, expected: string): boolean {
    const normalized = lower(expected);
    if (!normalized) return false;
    if (view.simpleOwnerLower === normalized) return true;
    if (view.ownerLower === normalized) return true;
    return view.ownerLower.endsWith(`.${normalized}`) || view.ownerLower.includes(`<${normalized}>`);
}

function extractSimpleClassName(ownerText: string): string {
    const trimmed = String(ownerText || "").trim();
    if (!trimmed) return "";
    const direct = trimmed.match(/([A-Za-z0-9_$]+)\s*(?:<[^>]+>)?$/);
    return direct?.[1] || trimmed;
}

function normalizeSpace(value: string): string {
    return String(value || "").replace(/\s+/g, "");
}

function containsAny(haystack: string, needles: string[]): boolean {
    return needles.some(needle => haystack.includes(needle));
}

function lower(value: unknown): string {
    return String(value || "").trim().toLowerCase();
}
