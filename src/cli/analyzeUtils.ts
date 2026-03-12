import { Scene } from "../../arkanalyzer/out/src/Scene";
import { ArkAssignStmt } from "../../arkanalyzer/out/src/core/base/Stmt";
import { ArkArrayRef, ArkParameterRef } from "../../arkanalyzer/out/src/core/base/Ref";
import { ArkInstanceInvokeExpr, ArkPtrInvokeExpr, ArkStaticInvokeExpr } from "../../arkanalyzer/out/src/core/base/Expr";
import { Local } from "../../arkanalyzer/out/src/core/base/Local";
import { TaintFlow } from "../core/TaintFlow";
import { TaintPropagationEngine } from "../core/TaintPropagationEngine";
import { SanitizerRule, SinkRule, SourceRule } from "../core/rules/RuleSchema";
import { buildSmokeRuleConfig, LoadedRuleSet } from "../core/rules/RuleLoader";

export interface FlowRuleTrace {
    source: string;
    sink: string;
    sourceRuleId?: string;
    sinkRuleId?: string;
    sinkEndpoint?: string;
    transferRuleIds: string[];
}

const RULE_CONFIG_FALLBACK = buildSmokeRuleConfig(undefined);
const CALLBACK_INVOKE_HINTS = new Set([
    "onclick", "onchange", "onsubmit", "then", "catch", "finally",
    "foreach", "map", "filter", "reduce", "subscribe", "emit",
    "register", "listen", "addlistener", "settimeout", "setinterval",
]);
const INIT_NAME_PATTERN = /(data|state|model|info|result|resp|response|record|entity|item|user|token|msg|payload|query|param|url|uri|path|text|content|name|id)/i;
const INIT_CALLEE_PATTERN = /(get|fetch|load|query|request|read|find|resolve|parse|decode|open|from)/i;

export function extractArkFileFromSignature(signature: string): string | undefined {
    const m = signature.match(/<@([^:>]+\.ets):/);
    if (m) return m[1].replace(/\\/g, "/");
    const m2 = signature.match(/@([^:>]+\.ets):/);
    if (m2) return m2[1].replace(/\\/g, "/");
    return undefined;
}

function getParameterLocalNames(entryMethod: any): Set<string> {
    const names = new Set<string>();
    const cfg = entryMethod.getCfg();
    if (!cfg) return names;

    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        if (!(stmt.getRightOp() instanceof ArkParameterRef)) continue;
        const leftOp = stmt.getLeftOp();
        if (leftOp instanceof Local) names.add(leftOp.getName());
    }
    return names;
}

function getSourceLikeLocals(entryMethod: any, sourcePattern: RegExp): string[] {
    const body = entryMethod.getBody();
    if (!body) return [];
    const out: string[] = [];
    for (const local of body.getLocals().values()) {
        if (sourcePattern.test(local.getName())) out.push(local.getName());
    }
    return out;
}

function resolveInvokeMethodName(invokeExpr: any): string {
    if (!invokeExpr) return "";
    const fromSig = invokeExpr.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || "";
    if (fromSig) return String(fromSig);
    const sig = invokeExpr.getMethodSignature?.()?.toString?.() || "";
    const m = sig.match(/\.([A-Za-z0-9_$]+)\(/);
    return m ? m[1] : "";
}

function extractMethodLikeNames(text: string): Set<string> {
    const out = new Set<string>();
    if (!text) return out;
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(text)) out.add(text);
    const amMatches = text.match(/%AM\d+\$[A-Za-z0-9_]+/g) || [];
    for (const m of amMatches) out.add(m);
    const sigMethodMatches = text.matchAll(/\.([A-Za-z0-9_$]+)\(/g);
    for (const m of sigMethodMatches) {
        if (m[1]) out.add(m[1]);
    }
    return out;
}

function resolveCallbackNameCandidates(value: any, visitingLocals: Set<string> = new Set()): Set<string> {
    const names = new Set<string>();
    const text = value?.toString?.() || "";
    for (const n of extractMethodLikeNames(text)) names.add(n);

    if (value instanceof Local) {
        const localName = value.getName();
        names.add(localName);
        if (visitingLocals.has(localName)) return names;
        visitingLocals.add(localName);

        const decl = value.getDeclaringStmt();
        if (decl instanceof ArkAssignStmt && decl.getLeftOp() === value) {
            const right = decl.getRightOp();
            if (right instanceof Local) {
                for (const n of resolveCallbackNameCandidates(right, visitingLocals)) names.add(n);
            } else if (right instanceof ArkInstanceInvokeExpr || right instanceof ArkStaticInvokeExpr || right instanceof ArkPtrInvokeExpr) {
                const methodName = resolveInvokeMethodName(right);
                if (methodName) names.add(methodName);
            } else {
                for (const n of extractMethodLikeNames(right?.toString?.() || "")) names.add(n);
            }
        }
    }
    return names;
}

function collectMethodParameterLocals(method: any): Local[] {
    const out: Local[] = [];
    const cfg = method.getCfg();
    if (!cfg) return out;
    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        if (!(stmt.getRightOp() instanceof ArkParameterRef)) continue;
        const left = stmt.getLeftOp();
        if (left instanceof Local) out.push(left);
    }
    return out;
}

function collectLikelyCallbackMethods(scene: Scene, entryMethod: any): any[] {
    const bySignature = new Map<string, any>();
    const allMethods = scene.getMethods();
    const entryNameLower = String(entryMethod.getName() || "").toLowerCase();
    const entrySig = entryMethod.getSignature()?.toString?.() || "";
    const entryFile = extractArkFileFromSignature(entrySig)?.toLowerCase();

    for (const method of allMethods) {
        if (method === entryMethod) continue;
        const methodName = String(method.getName() || "");
        if (!methodName.startsWith("%AM")) continue;
        const sig = method.getSignature()?.toString?.() || "";
        const methodFile = extractArkFileFromSignature(sig)?.toLowerCase();
        if (entryFile && methodFile && methodFile === entryFile && methodName.toLowerCase().includes(`$${entryNameLower}`)) {
            bySignature.set(sig, method);
        }
    }

    const cfg = entryMethod.getCfg();
    if (!cfg) return [...bySignature.values()];
    for (const stmt of cfg.getStmts()) {
        if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
        const invokeExpr = stmt.getInvokeExpr();
        if (!invokeExpr) continue;
        const invokeNameLower = resolveInvokeMethodName(invokeExpr).toLowerCase();
        const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
        if (args.length === 0) continue;
        const looksLikeCallbackInvoke = CALLBACK_INVOKE_HINTS.has(invokeNameLower) || invokeNameLower.startsWith("on");
        if (!looksLikeCallbackInvoke) continue;
        const callbackNameHints = new Set<string>();
        for (const arg of args) {
            for (const n of resolveCallbackNameCandidates(arg)) callbackNameHints.add(n);
        }
        for (const method of allMethods) {
            if (!callbackNameHints.has(String(method.getName() || ""))) continue;
            bySignature.set(method.getSignature()?.toString?.() || method.getName(), method);
        }
    }
    return [...bySignature.values()];
}

function localUsedAsInvokeArgument(local: Local): boolean {
    for (const stmt of local.getUsedStmts()) {
        if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
        const invokeExpr = stmt.getInvokeExpr();
        if (!invokeExpr || !invokeExpr.getArgs) continue;
        if (invokeExpr.getArgs().some((arg: any) => arg === local)) return true;
    }
    return false;
}

function collectInitializationFallbackLocals(entryMethod: any, sourcePattern: RegExp): Local[] {
    const body = entryMethod.getBody();
    if (!body) return [];
    const scored: Array<{ local: Local; score: number }> = [];
    for (const local of body.getLocals().values()) {
        const decl = local.getDeclaringStmt();
        if (!(decl instanceof ArkAssignStmt) || decl.getLeftOp() !== local) continue;
        const right = decl.getRightOp();
        let score = 0;
        if (sourcePattern.test(local.getName())) score += 2;
        if (INIT_NAME_PATTERN.test(local.getName())) score += 1;
        if (right instanceof ArkInstanceInvokeExpr || right instanceof ArkStaticInvokeExpr || right instanceof ArkPtrInvokeExpr) {
            score += 2;
            if (INIT_CALLEE_PATTERN.test(resolveInvokeMethodName(right))) score += 1;
        } else if (right instanceof ArkArrayRef || right instanceof Local) {
            score += 1;
        }
        if (localUsedAsInvokeArgument(local)) score += 1;
        if (score >= 2) scored.push({ local, score });
    }
    scored.sort((a, b) => b.score - a.score || a.local.getName().localeCompare(b.local.getName()));
    return scored.slice(0, 8).map(x => x.local);
}

export function collectSeedNodes(
    scene: Scene,
    engine: TaintPropagationEngine,
    entryMethod: any,
    sourcePattern: RegExp,
    options?: {
        enableSourceLikeNameSeed?: boolean;
        enableCrossFunctionFallback?: boolean;
    }
): { nodes: any[]; localNames: string[]; strategies: string[] } {
    const enableSourceLikeNameSeed = options?.enableSourceLikeNameSeed !== false;
    const enableCrossFunctionFallback = options?.enableCrossFunctionFallback === true;
    const body = entryMethod.getBody();
    if (!body) return { nodes: [], localNames: [], strategies: [] };
    const paramLocalNames = getParameterLocalNames(entryMethod);
    const localNames = new Set<string>();
    const nodeIds = new Set<number>();
    const strategies = new Set<string>();
    const nodes: any[] = [];

    const addLocalSeed = (local: Local, strategy: string): void => {
        const pagNodes = engine.pag.getNodesByValue(local);
        if (!pagNodes || pagNodes.size === 0) return;
        let added = false;
        for (const nodeId of pagNodes.values()) {
            if (nodeIds.has(nodeId)) continue;
            nodeIds.add(nodeId);
            nodes.push(engine.pag.getNode(nodeId));
            added = true;
        }
        if (added) {
            localNames.add(local.getName());
            strategies.add(strategy);
        }
    };

    for (const local of body.getLocals().values()) {
        const localName = local.getName();
        if (paramLocalNames.has(localName)) addLocalSeed(local, "direct:param");
        else if (enableSourceLikeNameSeed && sourcePattern.test(localName)) addLocalSeed(local, "direct:source_like_name");
    }

    for (const callbackMethod of collectLikelyCallbackMethods(scene, entryMethod)) {
        for (const paramLocal of collectMethodParameterLocals(callbackMethod)) addLocalSeed(paramLocal, "callback:param");
    }

    if (enableCrossFunctionFallback && nodes.length === 0) {
        for (const local of collectInitializationFallbackLocals(entryMethod, sourcePattern)) {
            addLocalSeed(local, "init:cross_function_fallback");
        }
    }

    return { nodes, localNames: [...localNames].sort(), strategies: [...strategies].sort() };
}

export function collectDummyMainSeedNodes(
    scene: Scene,
    engine: TaintPropagationEngine,
    sourcePattern: RegExp,
    options?: {
        enableSourceLikeNameSeed?: boolean;
        enableCrossFunctionFallback?: boolean;
        allowedMethodSignatures?: Set<string>;
    }
): { nodes: any[]; localNames: string[]; strategies: string[] } {
    const enableSourceLikeNameSeed = options?.enableSourceLikeNameSeed !== false;
    const enableCrossFunctionFallback = options?.enableCrossFunctionFallback === true;
    const allowedMethodSignatures = options?.allowedMethodSignatures;
    const localNames = new Set<string>();
    const nodeIds = new Set<number>();
    const strategies = new Set<string>();
    const nodes: any[] = [];

    const methods = scene.getMethods().filter(method => {
        if (!method.getBody() || !method.getCfg()) return false;
        if (!allowedMethodSignatures || allowedMethodSignatures.size === 0) return true;
        return allowedMethodSignatures.has(method.getSignature().toString());
    });

    const addLocalSeed = (local: Local, strategy: string): boolean => {
        const pagNodes = engine.pag.getNodesByValue(local);
        if (!pagNodes || pagNodes.size === 0) return false;
        let added = false;
        for (const nodeId of pagNodes.values()) {
            if (nodeIds.has(nodeId)) continue;
            nodeIds.add(nodeId);
            nodes.push(engine.pag.getNode(nodeId));
            added = true;
        }
        if (added) {
            localNames.add(local.getName());
            strategies.add(strategy);
        }
        return added;
    };

    for (const method of methods) {
        const body = method.getBody();
        if (!body) continue;
        const paramLocalNames = getParameterLocalNames(method);
        for (const local of body.getLocals().values()) {
            const localName = local.getName();
            if (paramLocalNames.has(localName)) {
                addLocalSeed(local, "dummyMain:param");
                continue;
            }
            if (enableSourceLikeNameSeed && sourcePattern.test(localName)) {
                addLocalSeed(local, "dummyMain:source_like_name");
            }
        }
    }

    if (enableCrossFunctionFallback && nodes.length === 0) {
        for (const method of methods) {
            for (const local of collectInitializationFallbackLocals(method, sourcePattern)) {
                addLocalSeed(local, "dummyMain:init_fallback");
            }
        }
    }

    return {
        nodes,
        localNames: [...localNames].sort(),
        strategies: [...strategies].sort(),
    };
}

export function detectFlows(
    engine: TaintPropagationEngine,
    loadedRules: LoadedRuleSet | undefined,
    options?: {
        detailed?: boolean;
        stopOnFirstFlow?: boolean;
        maxFlowsPerEntry?: number;
        enableSecondarySinkSweep?: boolean;
    }
): {
    totalFlowCount: number;
    sinkSamples: string[];
    byKeyword: Record<string, number>;
    bySignature: Record<string, number>;
    flowRuleTraces: FlowRuleTrace[];
} {
    const detailed = options?.detailed !== false;
    const enableSecondarySinkSweep = options?.enableSecondarySinkSweep === true;
    const maxFlowLimit = options?.stopOnFirstFlow
        ? 1
        : options?.maxFlowsPerEntry;
    const sinkSamples: string[] = [];
    const byKeyword: Record<string, number> = {};
    const bySignature: Record<string, number> = {};
    const uniqueFlowKeys = new Set<string>();
    const flowTraceMap = new Map<string, FlowRuleTrace>();

    const sourcePattern = buildSmokeRuleConfig(loadedRules);
    const sinkKeywords = sourcePattern.sinkKeywords;
    const sinkSignatures = sourcePattern.sinkSignatures;
    const sinkRules = loadedRules?.ruleSet.sinks || [];
    const sanitizerRules: SanitizerRule[] = loadedRules?.ruleSet.sanitizers || [];

    const parseSourceRuleId = (source: string): string | undefined => {
        if (!source.startsWith("source_rule:")) return undefined;
        const id = source.slice("source_rule:".length).trim();
        return id.length > 0 ? id : undefined;
    };

    const pushFlowTrace = (key: string, flow: TaintFlow): void => {
        if (flowTraceMap.has(key)) return;
        flowTraceMap.set(key, {
            source: flow.source,
            sink: flow.sink.toString(),
            sourceRuleId: flow.sourceRuleId || parseSourceRuleId(flow.source),
            sinkRuleId: flow.sinkRuleId,
            sinkEndpoint: flow.sinkEndpoint,
            transferRuleIds: [...new Set(flow.transferRuleIds || [])].sort(),
        });
    };

    const collect = (label: string, token: string, flows: TaintFlow[]): number => {
        const bucket = new Set<string>();
        for (const flow of flows) {
            if (maxFlowLimit !== undefined && uniqueFlowKeys.size >= maxFlowLimit) break;
            const sinkText = flow.sink.toString();
            const key = `${flow.source} -> ${sinkText}`;
            bucket.add(key);
            if (!uniqueFlowKeys.has(key)) {
                uniqueFlowKeys.add(key);
                if (sinkSamples.length < 8) sinkSamples.push(`[${label}:${token}] ${sinkText}`);
            }
            if (detailed) {
                pushFlowTrace(key, flow);
            }
        }
        return bucket.size;
    };

    if (sinkRules.length > 0) {
        const flows = engine.detectSinksByRules(sinkRules as SinkRule[], {
            stopOnFirstFlow: options?.stopOnFirstFlow,
            maxFlowsPerEntry: options?.maxFlowsPerEntry,
            sanitizerRules,
        });
        collect("rule", "all", flows);
    }

    if (maxFlowLimit !== undefined && uniqueFlowKeys.size >= maxFlowLimit) {
        return {
            totalFlowCount: uniqueFlowKeys.size,
            sinkSamples,
            byKeyword,
            bySignature,
            flowRuleTraces: detailed ? [...flowTraceMap.values()] : [],
        };
    }

    if (detailed && enableSecondarySinkSweep) {
        for (const keyword of sinkKeywords) {
            if (maxFlowLimit !== undefined && uniqueFlowKeys.size >= maxFlowLimit) break;
            byKeyword[keyword] = collect("kw", keyword, engine.detectSinks(keyword, { sanitizerRules }));
        }
        for (const signature of sinkSignatures) {
            if (maxFlowLimit !== undefined && uniqueFlowKeys.size >= maxFlowLimit) break;
            bySignature[signature] = collect("sig", signature, engine.detectSinks(signature, { sanitizerRules }));
        }
    }

    // Developer-friendly fallback for taint demo projects.
    if (enableSecondarySinkSweep && uniqueFlowKeys.size === 0) {
        const sinkByName = collect("sig", "Sink", engine.detectSinks("Sink", { sanitizerRules }));
        const sinkBySig = collect("sig", "taint.%dflt.Sink", engine.detectSinks("taint.%dflt.Sink", { sanitizerRules }));
        if (detailed) {
            bySignature["Sink"] = sinkByName;
            bySignature["taint.%dflt.Sink"] = sinkBySig;
        }
    }

    return {
        totalFlowCount: uniqueFlowKeys.size,
        sinkSamples,
        byKeyword,
        bySignature,
        flowRuleTraces: detailed ? [...flowTraceMap.values()] : [],
    };
}

export function getSourcePattern(loadedRules: LoadedRuleSet | undefined): RegExp {
    return buildSmokeRuleConfig(loadedRules).sourceLocalNamePattern || RULE_CONFIG_FALLBACK.sourceLocalNamePattern;
}

export function getSourceRules(loadedRules: LoadedRuleSet | undefined): SourceRule[] {
    return loadedRules?.ruleSet.sources || [];
}
