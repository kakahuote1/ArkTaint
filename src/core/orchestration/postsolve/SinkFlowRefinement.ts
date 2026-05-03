import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { Pag } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkInstanceFieldRef } from "../../../../arkanalyzer/out/src/core/base/Ref";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import { ArkInstanceInvokeExpr, ArkStaticInvokeExpr } from "../../../../arkanalyzer/out/src/core/base/Expr";
import { ArkMethod } from "../../../../arkanalyzer/out/src/core/model/ArkMethod";
import { TaintFlow } from "../../kernel/model/TaintFlow";
import {
    collectKnownKeyedDispatchKeysFromMethod,
    resolveKnownKeyedCallbackRegistrationsFromStmt,
} from "../../entry/shared/FrameworkCallbackClassifier";
import { collectFiniteStringCandidatesFromValue } from "../../substrate/queries/FiniteStringCandidateResolver";

/**
 * Deterministic sink-flow refinements that are currently applied after the main
 * propagation and sink matching pass. Keep this layer local and evidence-based:
 * it must not create propagation edges or discover new flows.
 */
export class SinkFlowRefinement {
    private keyedRouteMismatchCache: Map<string, boolean> = new Map();
    private routePushKeyCache: Map<string, Set<string>> = new Map();

    constructor(private readonly scene: Scene) {}

    filterFlows(flows: TaintFlow[], pag?: Pag): TaintFlow[] {
        return flows.filter(flow => !this.shouldSuppressFlow(flow, pag));
    }

    private shouldSuppressFlow(flow: TaintFlow, pag?: Pag): boolean {
        return this.shouldSuppressSafeOverwriteFlow(flow, pag)
            || this.shouldSuppressKeyedRouteCallbackMismatchFlow(flow);
    }

    private shouldSuppressSafeOverwriteFlow(flow: TaintFlow, pag?: Pag): boolean {
        const sinkNodeId = flow.sinkNodeId;
        if (sinkNodeId === undefined || sinkNodeId === null || !pag) return false;
        const sinkNode: any = pag.getNode?.(sinkNodeId);
        const sinkValue: any = sinkNode?.getValue?.();
        if (!(sinkValue instanceof Local)) return false;
        const declStmt: any = sinkValue.getDeclaringStmt?.();
        if (!(declStmt instanceof ArkAssignStmt)) return false;
        const right: any = declStmt.getRightOp?.();
        if (!(right instanceof ArkInstanceInvokeExpr)) return false;
        const methodSig = right.getMethodSignature?.();
        const methodName = methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "";
        if (methodName !== "get" && methodName !== "getSync") return false;
        if (!isKnownKeyedStorageSignature(String(methodSig?.toString?.() || ""))) return false;
        const args = right.getArgs?.() || [];
        if (args.length < 1) return false;
        const keyLiteral = normalizeQuotedLiteral(String(args[0]?.toString?.() || "").trim());
        if (!keyLiteral) return false;

        const cfg = declStmt.getCfg?.();
        if (!cfg) return false;
        const stmts: any[] = cfg.getStmts?.() || [];
        const idx = stmts.indexOf(declStmt);
        if (idx < 0) return false;

        for (let i = idx - 1; i >= 0; i--) {
            const stmt = stmts[i];
            if (!stmt?.containsInvokeExpr?.()) continue;
            const inv: any = stmt.getInvokeExpr?.();
            if (!(inv instanceof ArkInstanceInvokeExpr)) continue;
            if (!isSameReceiver(inv, right)) continue;
            const invName = inv.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || "";
            if (invName !== "put" && invName !== "putSync") continue;
            const invArgs = inv.getArgs?.() || [];
            if (invArgs.length < 2) continue;
            const putKey = normalizeQuotedLiteral(String(invArgs[0]?.toString?.() || "").trim());
            if (!putKey || putKey !== keyLiteral) continue;
            const putLiteral = normalizeQuotedLiteral(String(invArgs[1]?.toString?.() || "").trim());
            if (!putLiteral) return false;
            return true;
        }
        return false;
    }

    private shouldSuppressKeyedRouteCallbackMismatchFlow(flow: TaintFlow): boolean {
        const ruleId = flow.sourceRuleId || parseSourceRuleId(flow.source) || "";
        if (!ruleId.startsWith("source.auto.callback_param.")) return false;
        const sinkMethodSig = flow.sink?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.() || "";
        const filePath = extractFilePathFromSignature(sinkMethodSig);
        if (!filePath) return false;
        const cached = this.keyedRouteMismatchCache.get(filePath);
        if (cached !== undefined) return cached;
        const result = this.hasKnownNavDestinationRouteMismatchInFile(filePath);
        this.keyedRouteMismatchCache.set(filePath, result);
        return result;
    }

    private hasKnownNavDestinationRouteMismatchInFile(filePath: string): boolean {
        for (const sourceMethod of this.scene.getMethods()) {
            const sourceMethodSig = sourceMethod.getSignature?.()?.toString?.() || "";
            if (extractFilePathFromSignature(sourceMethodSig) !== filePath) continue;
            const dispatchKeys = collectKnownKeyedDispatchKeysFromMethod(this.scene, sourceMethod).get("nav_destination");
            if (!dispatchKeys || dispatchKeys.size === 0) continue;
            const pushRouteKeys = this.collectKnownRoutePushKeysFromMethod(sourceMethod);
            if (pushRouteKeys.size === 0) continue;

            const cfg = sourceMethod.getCfg?.();
            if (!cfg) continue;
            const registrationKeys = new Set<string>();
            for (const stmt of cfg.getStmts()) {
                const registrations = resolveKnownKeyedCallbackRegistrationsFromStmt(stmt, this.scene, sourceMethod);
                for (const reg of registrations) {
                    if (reg.familyId !== "nav_destination") continue;
                    for (const key of reg.dispatchKeys || []) registrationKeys.add(key);
                }
            }
            const effectiveDispatchKeys = intersectStringSets(dispatchKeys, registrationKeys);
            if (effectiveDispatchKeys.size === 0) continue;
            if (!hasStringSetIntersection(effectiveDispatchKeys, pushRouteKeys)) {
                return true;
            }
        }
        return false;
    }

    private collectKnownRoutePushKeysFromMethod(method: ArkMethod): Set<string> {
        const methodSig = method.getSignature?.()?.toString?.() || "";
        if (!methodSig) return new Set<string>();
        const cached = this.routePushKeyCache.get(methodSig);
        if (cached) return cached;

        const out = new Set<string>();
        const cfg = method.getCfg?.();
        const stmts = cfg?.getStmts?.() || [];
        const knownPushMethods = new Map<string, string>([
            ["pushNamedRoute", "name"],
            ["pushPath", "name"],
            ["pushPathByName", "name"],
            ["replacePath", "name"],
            ["pushUrl", "url"],
            ["replaceUrl", "url"],
        ]);

        const addKeysFromValue = (value: any, routeFieldName: string): void => {
            for (const literal of collectFiniteStringCandidatesFromValue(this.scene, value)) {
                if (literal) out.add(literal);
            }
            if (!(value instanceof Local)) return;
            for (const stmt of stmts) {
                if (!(stmt instanceof ArkAssignStmt)) continue;
                const left = stmt.getLeftOp?.();
                if (!(left instanceof ArkInstanceFieldRef)) continue;
                if (left.getBase?.() !== value) continue;
                const fieldName = left.getFieldSignature?.().getFieldName?.() || left.getFieldName?.() || "";
                if (fieldName !== routeFieldName) continue;
                for (const literal of collectFiniteStringCandidatesFromValue(this.scene, stmt.getRightOp?.())) {
                    if (literal) out.add(literal);
                }
            }
        };

        for (const stmt of stmts) {
            if (!stmt?.containsInvokeExpr?.()) continue;
            const invokeExpr = stmt.getInvokeExpr?.();
            if (!(invokeExpr instanceof ArkStaticInvokeExpr || invokeExpr instanceof ArkInstanceInvokeExpr)) continue;
            const methodName = invokeExpr.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || "";
            const routeFieldName = knownPushMethods.get(methodName);
            if (!routeFieldName) continue;
            const invokeArgs = invokeExpr.getArgs?.() || [];
            for (const arg of invokeArgs) {
                addKeysFromValue(arg, routeFieldName);
            }
        }

        this.routePushKeyCache.set(methodSig, out);
        return out;
    }
}

export function extractFilePathFromSignature(signature: string): string {
    const at = signature.indexOf("@");
    if (at < 0) return "";
    const methodSep = signature.indexOf(": ", at);
    if (methodSep < 0) return "";
    return signature.slice(at + 1, methodSep).replace(/\\/g, "/");
}

function parseSourceRuleId(source: string): string | undefined {
    if (!source.startsWith("source_rule:")) return undefined;
    const id = source.slice("source_rule:".length).trim();
    return id || undefined;
}

function normalizeQuotedLiteral(text: string): string | undefined {
    const m = String(text || "").match(/^['"`]((?:\\.|[^'"`])+)['"`]$/);
    return m ? m[1] : undefined;
}

function isSameReceiver(left: ArkInstanceInvokeExpr, right: ArkInstanceInvokeExpr): boolean {
    const leftBase = left.getBase?.();
    const rightBase = right.getBase?.();
    if (!leftBase || !rightBase) return false;
    if (leftBase === rightBase) return true;
    return String(leftBase?.toString?.() || "") === String(rightBase?.toString?.() || "");
}

function isKnownKeyedStorageSignature(signature: string): boolean {
    const text = signature.toLowerCase();
    return text.includes("preferences")
        || text.includes("distributedkv")
        || text.includes("kvstore")
        || text.includes("storage");
}

function intersectStringSets(left: Set<string>, right: Set<string>): Set<string> {
    const out = new Set<string>();
    for (const value of left) {
        if (right.has(value)) out.add(value);
    }
    return out;
}

function hasStringSetIntersection(left: Set<string>, right: Set<string>): boolean {
    for (const value of left) {
        if (right.has(value)) return true;
    }
    return false;
}
