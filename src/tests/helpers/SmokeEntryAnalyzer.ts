import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { TaintPropagationEngine } from "../../core/TaintPropagationEngine";
import { ArkAssignStmt } from "../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkInstanceInvokeExpr, ArkPtrInvokeExpr, ArkStaticInvokeExpr } from "../../../arkanalyzer/out/src/core/base/Expr";
import { ArkArrayRef, ArkInstanceFieldRef, ArkParameterRef, ClosureFieldRef } from "../../../arkanalyzer/out/src/core/base/Ref";
import { Local } from "../../../arkanalyzer/out/src/core/base/Local";
import { EntryCandidate, EntrySmokeResult } from "./SmokeTypes";
import {
    extractArkFileFromSignature,
    findEntryMethod,
    getParameterLocalNames,
} from "./SmokeEntrySelector";

export interface SmokeEntryAnalyzerConfig {
    sourceNamePattern: RegExp;
    initNamePattern: RegExp;
    initCalleePattern: RegExp;
    callbackInvokeHints: ReadonlySet<string>;
    sinkKeywords: string[];
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

    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(text)) {
        out.add(text);
    }

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
    const textCandidates = extractMethodLikeNames(text);
    for (const n of textCandidates) names.add(n);

    if (value instanceof Local) {
        const localName = value.getName();
        names.add(localName);
        if (visitingLocals.has(localName)) return names;
        visitingLocals.add(localName);

        const decl = value.getDeclaringStmt();
        if (decl instanceof ArkAssignStmt && decl.getLeftOp() === value) {
            const right = decl.getRightOp();
            if (right instanceof Local) {
                const rhsNames = resolveCallbackNameCandidates(right, visitingLocals);
                for (const n of rhsNames) names.add(n);
            } else if (right instanceof ArkInstanceInvokeExpr || right instanceof ArkStaticInvokeExpr || right instanceof ArkPtrInvokeExpr) {
                const methodName = resolveInvokeMethodName(right);
                if (methodName) names.add(methodName);
            } else {
                const rhsText = right?.toString?.() || "";
                const rhsNames = extractMethodLikeNames(rhsText);
                for (const n of rhsNames) names.add(n);
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

function collectLikelyCallbackMethods(
    scene: Scene,
    entryMethod: any,
    callbackInvokeHints: ReadonlySet<string>
): any[] {
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
        const looksLikeCallbackInvoke = callbackInvokeHints.has(invokeNameLower) || invokeNameLower.startsWith("on");
        if (!looksLikeCallbackInvoke) continue;

        const callbackNameHints = new Set<string>();
        for (const arg of args) {
            const names = resolveCallbackNameCandidates(arg);
            for (const n of names) callbackNameHints.add(n);
        }
        if (callbackNameHints.size === 0) continue;

        for (const method of allMethods) {
            const methodName = String(method.getName() || "");
            if (!callbackNameHints.has(methodName)) continue;
            const sig = method.getSignature()?.toString?.() || methodName;
            bySignature.set(sig, method);
        }
    }

    return [...bySignature.values()];
}

function localUsedAsInvokeArgument(local: Local): boolean {
    for (const stmt of local.getUsedStmts()) {
        if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
        const invokeExpr = stmt.getInvokeExpr();
        if (!invokeExpr || !invokeExpr.getArgs) continue;
        const args = invokeExpr.getArgs();
        if (args.some((arg: any) => arg === local)) return true;
    }
    return false;
}

function collectInitializationFallbackLocals(
    entryMethod: any,
    config: SmokeEntryAnalyzerConfig
): Local[] {
    const body = entryMethod.getBody();
    if (!body) return [];
    const scored: Array<{ local: Local; score: number }> = [];

    for (const local of body.getLocals().values()) {
        const decl = local.getDeclaringStmt();
        if (!(decl instanceof ArkAssignStmt) || decl.getLeftOp() !== local) continue;

        const right = decl.getRightOp();
        let score = 0;
        const localName = local.getName();
        if (config.sourceNamePattern.test(localName)) score += 2;
        if (config.initNamePattern.test(localName)) score += 1;

        if (right instanceof ArkInstanceInvokeExpr || right instanceof ArkStaticInvokeExpr || right instanceof ArkPtrInvokeExpr) {
            score += 2;
            const calleeName = resolveInvokeMethodName(right);
            if (config.initCalleePattern.test(calleeName)) score += 1;
        } else if (right instanceof ArkInstanceFieldRef || right instanceof ClosureFieldRef || right instanceof ArkArrayRef) {
            score += 1;
            const rightText = right.toString();
            if (config.sourceNamePattern.test(rightText) || config.initNamePattern.test(rightText)) score += 1;
        } else if (right instanceof Local) {
            if (config.sourceNamePattern.test(right.getName()) || config.initNamePattern.test(right.getName())) score += 1;
        }

        if (localUsedAsInvokeArgument(local)) score += 1;
        if (score < 2) continue;
        scored.push({ local, score });
    }

    scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.local.getName().localeCompare(b.local.getName());
    });
    return scored.slice(0, 8).map(x => x.local);
}

function collectSeedNodes(
    scene: Scene,
    engine: TaintPropagationEngine,
    entryMethod: any,
    config: SmokeEntryAnalyzerConfig
): { nodes: any[]; localNames: string[]; strategies: string[] } {
    const body = entryMethod.getBody();
    if (!body) return { nodes: [], localNames: [], strategies: [] };

    const paramLocalNames = getParameterLocalNames(entryMethod);
    const localNames = new Set<string>();
    const nodeIds = new Set<number>();
    const strategies = new Set<string>();
    const nodes: any[] = [];

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

    for (const local of body.getLocals().values()) {
        const localName = local.getName();
        if (paramLocalNames.has(localName)) {
            addLocalSeed(local, "direct:param");
            continue;
        }
        if (config.sourceNamePattern.test(localName)) {
            addLocalSeed(local, "direct:source_like_name");
        }
    }

    const callbackMethods = collectLikelyCallbackMethods(scene, entryMethod, config.callbackInvokeHints);
    for (const callbackMethod of callbackMethods) {
        for (const paramLocal of collectMethodParameterLocals(callbackMethod)) {
            addLocalSeed(paramLocal, "callback:param");
        }
    }

    if (nodes.length === 0) {
        for (const local of collectInitializationFallbackLocals(entryMethod, config)) {
            addLocalSeed(local, "init:cross_function_fallback");
        }
    }

    return {
        nodes,
        localNames: [...localNames].sort(),
        strategies: [...strategies].sort(),
    };
}

function detectFlowsByProfiles(
    engine: TaintPropagationEngine,
    signaturePatterns: string[],
    sinkKeywords: string[]
): { totalFlowCount: number; byKeyword: Record<string, number>; bySignature: Record<string, number>; sinkSamples: string[] } {
    const uniqueFlowKeys = new Set<string>();
    const byKeyword: Record<string, number> = {};
    const bySignature: Record<string, number> = {};
    const sinkSamples: string[] = [];

    const collect = (bucket: "keyword" | "signature", token: string): number => {
        const flows = engine.detectSinks(token);
        const bucketKeys = new Set<string>();
        const label = bucket === "keyword" ? `kw:${token}` : `sig:${token}`;
        for (const flow of flows) {
            const sinkText = flow.sink.toString();
            const key = `${flow.source} -> ${sinkText}`;
            bucketKeys.add(key);
            if (!uniqueFlowKeys.has(key)) {
                uniqueFlowKeys.add(key);
                if (sinkSamples.length < 8) {
                    sinkSamples.push(`[${label}] ${sinkText}`);
                }
            }
        }
        return bucketKeys.size;
    };

    for (const keyword of sinkKeywords) {
        byKeyword[keyword] = collect("keyword", keyword);
    }

    for (const signaturePattern of signaturePatterns) {
        bySignature[signaturePattern] = collect("signature", signaturePattern);
    }

    return {
        totalFlowCount: uniqueFlowKeys.size,
        byKeyword,
        bySignature,
        sinkSamples,
    };
}

function createBaseEntryResult(candidate: EntryCandidate, status: EntrySmokeResult["status"], elapsedMs: number): EntrySmokeResult {
    return {
        sourceDir: candidate.sourceDir,
        entryName: candidate.name,
        entryPathHint: candidate.pathHint,
        signature: candidate.signature,
        score: candidate.score,
        status,
        seedLocalNames: [],
        seedStrategies: [],
        seedCount: 0,
        flowCount: 0,
        sinkFlowByKeyword: {},
        sinkFlowBySignature: {},
        sinkSamples: [],
        elapsedMs,
    };
}

export async function analyzeEntry(
    scene: Scene,
    candidate: EntryCandidate,
    k: number,
    signaturePatterns: string[],
    config: SmokeEntryAnalyzerConfig
): Promise<EntrySmokeResult> {
    const t0 = Date.now();
    try {
        const engine = new TaintPropagationEngine(scene, k);
        engine.verbose = false;
        await engine.buildPAG(candidate.name, candidate.pathHint);

        const entryMethod = findEntryMethod(scene, candidate);
        if (!entryMethod) {
            return createBaseEntryResult(candidate, "no_entry", Date.now() - t0);
        }
        if (!entryMethod.getBody()) {
            return createBaseEntryResult(candidate, "no_body", Date.now() - t0);
        }

        const seeds = collectSeedNodes(scene, engine, entryMethod, config);
        if (seeds.nodes.length === 0) {
            return createBaseEntryResult(candidate, "no_seed", Date.now() - t0);
        }

        engine.propagateWithSeeds(seeds.nodes);
        const detected = detectFlowsByProfiles(engine, signaturePatterns, config.sinkKeywords);
        return {
            sourceDir: candidate.sourceDir,
            entryName: candidate.name,
            entryPathHint: candidate.pathHint,
            signature: candidate.signature,
            score: candidate.score,
            status: "ok",
            seedLocalNames: seeds.localNames,
            seedStrategies: seeds.strategies,
            seedCount: seeds.nodes.length,
            flowCount: detected.totalFlowCount,
            sinkFlowByKeyword: detected.byKeyword,
            sinkFlowBySignature: detected.bySignature,
            sinkSamples: detected.sinkSamples,
            elapsedMs: Date.now() - t0,
        };
    } catch (err: any) {
        const base = createBaseEntryResult(candidate, "exception", Date.now() - t0);
        base.error = String(err?.message || err);
        return base;
    }
}
