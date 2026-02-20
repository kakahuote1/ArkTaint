import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { Pag } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt } from "../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkInstanceFieldRef, ArkParameterRef } from "../../../arkanalyzer/out/src/core/base/Ref";
import { ArkInstanceInvokeExpr, ArkPtrInvokeExpr } from "../../../arkanalyzer/out/src/core/base/Expr";
import { Local } from "../../../arkanalyzer/out/src/core/base/Local";
import { ArkMethod } from "../../../arkanalyzer/out/src/core/model/ArkMethod";
import { TaintFact } from "../TaintFact";
import {
    RuleEndpoint,
    RuleInvokeKind,
    RuleScopeConstraint,
    RuleStringConstraint,
    SourceRule,
    SourceRuleKind,
} from "../rules/RuleSchema";

export interface SourceRuleSeedCollectionArgs {
    scene: Scene;
    pag: Pag;
    sourceRules: SourceRule[];
    emptyContextId: number;
    entryMethodName?: string;
    entryMethodPathHint?: string;
}

export interface SourceRuleSeedCollectionResult {
    facts: TaintFact[];
    seededLocals: string[];
    sourceRuleHits: Record<string, number>;
}

export function collectSourceRuleSeeds(args: SourceRuleSeedCollectionArgs): SourceRuleSeedCollectionResult {
    const methods = resolveSourceScopeMethods(args.scene, args.entryMethodName, args.entryMethodPathHint);
    const facts: TaintFact[] = [];
    const seededLocals = new Set<string>();
    const seenFactIds = new Set<string>();
    const sourceRuleHits = new Map<string, number>();

    const pushFact = (fact: TaintFact, label: string, ruleId: string): void => {
        if (seenFactIds.has(fact.id)) return;
        seenFactIds.add(fact.id);
        facts.push(fact);
        seededLocals.add(label);
        sourceRuleHits.set(ruleId, (sourceRuleHits.get(ruleId) || 0) + 1);
    };

    for (const rule of args.sourceRules) {
        if (rule.enabled === false) continue;
        const kind = resolveSourceRuleKind(rule);
        const target = resolveSourceRuleTarget(rule, kind);
        const sourceTag = `source_rule:${rule.id}`;

        for (const method of methods) {
            if (!matchesScope(method, rule.scope)) continue;

            if (kind === "seed_local_name" || kind === "entry_param") {
                const body = method.getBody();
                if (!body) continue;
                const paramLocals = getParameterLocals(method);

                for (const local of body.getLocals().values()) {
                    const localName = local.getName();
                    const param = paramLocals.find(p => p.local.getName() === localName);
                    const paramIndex = param ? param.index : undefined;

                    if (!matchesSourceLocalRule(rule, kind, method, localName, paramIndex)) continue;

                    const localFacts = seedFactsFromValue(args.pag, local, sourceTag, args.emptyContextId, target.path);
                    for (const fact of localFacts) {
                        pushFact(fact, `${method.getName()}:${localName}`, rule.id);
                    }
                }
                continue;
            }

            const cfg = method.getCfg();
            if (!cfg) continue;

            if (kind === "call_return" || kind === "call_arg") {
                for (const stmt of cfg.getStmts()) {
                    if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
                    const invokeExpr = stmt.getInvokeExpr();
                    if (!invokeExpr) continue;

                    const calleeSignature = invokeExpr.getMethodSignature?.().toString?.() || "";
                    const calleeName = resolveInvokeMethodName(invokeExpr, calleeSignature);
                    if (!matchesSourceCallRule(rule, calleeSignature, calleeName, invokeExpr)) continue;

                    const targetValue = resolveInvokeTargetValue(stmt, invokeExpr, target.endpoint);
                    if (!targetValue) continue;

                    const callFacts = seedFactsFromValue(args.pag, targetValue, sourceTag, args.emptyContextId, target.path);
                    for (const fact of callFacts) {
                        const line = stmt.getOriginPositionInfo?.().getLineNo?.() ?? -1;
                        pushFact(fact, `${method.getName()}:line${line}`, rule.id);
                    }
                }
                continue;
            }

            if (kind === "field_read") {
                for (const stmt of cfg.getStmts()) {
                    if (!(stmt instanceof ArkAssignStmt)) continue;
                    const right = stmt.getRightOp();
                    if (!(right instanceof ArkInstanceFieldRef)) continue;
                    const left = stmt.getLeftOp();

                    const fieldName = right.getFieldSignature().getFieldName();
                    const fieldSignature = right.getFieldSignature().toString();
                    if (!matchesSourceFieldReadRule(rule, method, left?.toString?.() || "", fieldName, fieldSignature)) {
                        continue;
                    }
                    if (target.path && target.path.length > 0 && target.path[0] !== fieldName) {
                        continue;
                    }

                    const targetValue = resolveFieldReadTargetValue(stmt, right, target.endpoint);
                    if (!targetValue) continue;

                    const readFacts = seedFactsFromValue(args.pag, targetValue, sourceTag, args.emptyContextId, undefined);
                    for (const fact of readFacts) {
                        pushFact(fact, `${method.getName()}:${fieldName}`, rule.id);
                    }
                }
            }
        }
    }

    return {
        facts,
        seededLocals: [...seededLocals].sort(),
        sourceRuleHits: toRecord(sourceRuleHits),
    };
}

function resolveSourceScopeMethods(scene: Scene, entryMethodName?: string, entryMethodPathHint?: string): ArkMethod[] {
    const allMethods = scene.getMethods().filter(m => m.getName() !== "%dflt");
    if (!entryMethodName) return allMethods;

    const candidates = allMethods.filter(m => m.getName() === entryMethodName);
    if (!entryMethodPathHint) return candidates;

    const normalizedHint = entryMethodPathHint.replace(/\\/g, "/");
    const hinted = candidates.filter(m => m.getSignature().toString().includes(normalizedHint));
    return hinted.length > 0 ? hinted : candidates;
}

function getParameterLocals(method: ArkMethod): Array<{ index: number; local: Local }> {
    const out: Array<{ index: number; local: Local }> = [];
    const cfg = method.getCfg();
    if (!cfg) return out;

    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        if (!(stmt.getRightOp() instanceof ArkParameterRef)) continue;
        const leftOp = stmt.getLeftOp();
        if (!(leftOp instanceof Local)) continue;

        const refText = stmt.getRightOp().toString();
        const m = refText.match(/parameter(\d+)/);
        if (!m) continue;

        out.push({
            index: Number(m[1]),
            local: leftOp,
        });
    }
    out.sort((a, b) => a.index - b.index);
    return out;
}

function resolveSourceRuleKind(rule: SourceRule): SourceRuleKind {
    if (rule.kind) return rule.kind;
    if (rule.profile === "entry_param") return "entry_param";
    return "seed_local_name";
}

function resolveSourceRuleTarget(
    rule: SourceRule,
    kind: SourceRuleKind
): { endpoint?: RuleEndpoint; path?: string[] } {
    const endpoint = rule.targetRef?.endpoint || rule.target
        || (kind === "entry_param" ? "arg0"
            : kind === "call_return" ? "result"
                : kind === "call_arg" ? "arg0"
                    : kind === "field_read" ? "result"
                        : undefined);
    return {
        endpoint,
        path: rule.targetRef?.path,
    };
}

function resolveInvokeMethodName(invokeExpr: any, signature: string): string {
    const fromSig = invokeExpr.getMethodSignature?.().getMethodSubSignature?.().getMethodName?.() || "";
    if (fromSig) return String(fromSig);
    const m = signature.match(/\.([A-Za-z0-9_$]+)\(/);
    return m ? m[1] : "";
}

function matchesSourceLocalRule(
    rule: SourceRule,
    kind: SourceRuleKind,
    method: ArkMethod,
    localName: string,
    paramIndex?: number
): boolean {
    if (kind === "entry_param" && paramIndex === undefined) {
        return false;
    }

    const targetEndpoint = rule.targetRef?.endpoint || rule.target;
    if (kind === "entry_param" && targetEndpoint) {
        const m = /^arg(\d+)$/.exec(targetEndpoint);
        if (m && Number(m[1]) !== paramIndex) {
            return false;
        }
    }

    const methodSignature = method.getSignature().toString();
    const methodName = method.getName();
    const value = rule.match.value || "";
    switch (rule.match.kind) {
        case "local_name_regex":
            try {
                return new RegExp(value).test(localName);
            } catch {
                return false;
            }
        case "method_name_equals":
            return methodName === value;
        case "method_name_regex":
            try {
                return new RegExp(value).test(methodName);
            } catch {
                return false;
            }
        case "signature_contains":
            return methodSignature.includes(value);
        case "signature_regex":
            try {
                return new RegExp(value).test(methodSignature);
            } catch {
                return false;
            }
        default:
            return false;
    }
}

function matchesSourceCallRule(
    rule: SourceRule,
    calleeSignature: string,
    calleeName: string,
    invokeExpr: any
): boolean {
    if (!matchesInvokeShape(rule, invokeExpr, calleeSignature)) return false;

    const value = rule.match.value || "";
    switch (rule.match.kind) {
        case "method_name_equals":
            return calleeName === value;
        case "method_name_regex":
            try {
                return new RegExp(value).test(calleeName);
            } catch {
                return false;
            }
        case "signature_contains":
            return calleeSignature.includes(value);
        case "signature_regex":
            try {
                return new RegExp(value).test(calleeSignature);
            } catch {
                return false;
            }
        case "local_name_regex": {
            const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
            const argTexts = args.map((a: any) => a?.toString?.() || "");
            if (invokeExpr instanceof ArkInstanceInvokeExpr) {
                argTexts.push(invokeExpr.getBase()?.toString?.() || "");
            }
            try {
                const re = new RegExp(value);
                return argTexts.some((text: string) => re.test(text));
            } catch {
                return false;
            }
        }
        default:
            return false;
    }
}

function matchesSourceFieldReadRule(
    rule: SourceRule,
    method: ArkMethod,
    leftText: string,
    fieldName: string,
    fieldSignature: string
): boolean {
    const value = rule.match.value || "";
    switch (rule.match.kind) {
        case "method_name_equals":
            return method.getName() === value;
        case "method_name_regex":
            try {
                return new RegExp(value).test(method.getName());
            } catch {
                return false;
            }
        case "signature_contains":
            return fieldSignature.includes(value) || method.getSignature().toString().includes(value);
        case "signature_regex":
            try {
                const re = new RegExp(value);
                return re.test(fieldSignature) || re.test(method.getSignature().toString());
            } catch {
                return false;
            }
        case "local_name_regex":
            try {
                const re = new RegExp(value);
                return re.test(leftText) || re.test(fieldName);
            } catch {
                return false;
            }
        default:
            return false;
    }
}

function matchesInvokeShape(rule: SourceRule, invokeExpr: any, calleeSignature: string): boolean {
    if (rule.invokeKind && rule.invokeKind !== "any") {
        const actualKind: RuleInvokeKind = invokeExpr instanceof ArkInstanceInvokeExpr ? "instance" : "static";
        if (actualKind !== rule.invokeKind) return false;
    }

    if (rule.argCount !== undefined) {
        const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
        if (args.length !== rule.argCount) return false;
    }

    if (rule.typeHint && rule.typeHint.trim().length > 0) {
        const hint = rule.typeHint.trim().toLowerCase();
        const declaringClass = invokeExpr.getMethodSignature?.().getDeclaringClassSignature?.()?.toString?.() || "";
        const baseText = invokeExpr instanceof ArkInstanceInvokeExpr ? (invokeExpr.getBase()?.toString?.() || "") : "";
        const ptrText = invokeExpr instanceof ArkPtrInvokeExpr ? (invokeExpr.toString?.() || "") : "";
        const haystack = `${calleeSignature} ${declaringClass} ${baseText} ${ptrText}`.toLowerCase();
        if (!haystack.includes(hint)) return false;
    }

    return true;
}

function resolveInvokeTargetValue(stmt: any, invokeExpr: any, endpoint?: RuleEndpoint): any | undefined {
    if (!endpoint || endpoint === "result") {
        if (!(stmt instanceof ArkAssignStmt)) return undefined;
        return stmt.getLeftOp();
    }
    if (endpoint === "base") {
        if (invokeExpr instanceof ArkInstanceInvokeExpr) return invokeExpr.getBase();
        return undefined;
    }
    const m = /^arg(\d+)$/.exec(endpoint);
    if (!m) return undefined;
    const idx = Number(m[1]);
    const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
    if (!Number.isFinite(idx) || idx < 0 || idx >= args.length) return undefined;
    return args[idx];
}

function resolveFieldReadTargetValue(
    stmt: ArkAssignStmt,
    fieldRef: ArkInstanceFieldRef,
    endpoint?: RuleEndpoint
): any | undefined {
    if (!endpoint || endpoint === "result") {
        return stmt.getLeftOp();
    }
    if (endpoint === "base") {
        return fieldRef.getBase();
    }
    return undefined;
}

function seedFactsFromValue(
    pag: Pag,
    value: any,
    sourceTag: string,
    contextId: number,
    targetPath?: string[]
): TaintFact[] {
    const out: TaintFact[] = [];
    const seen = new Set<string>();
    const add = (fact: TaintFact): void => {
        if (seen.has(fact.id)) return;
        seen.add(fact.id);
        out.push(fact);
    };

    const pagNodes = pag.getNodesByValue(value);
    if (!pagNodes || pagNodes.size === 0) return out;

    if (targetPath && targetPath.length > 0) {
        let hasFieldFact = false;
        for (const nodeId of pagNodes.values()) {
            const rootNode: any = pag.getNode(nodeId);
            for (const objId of rootNode.getPointTo()) {
                hasFieldFact = true;
                const objNode: any = pag.getNode(objId);
                add(new TaintFact(objNode, sourceTag, contextId, [...targetPath]));
            }
        }
        if (hasFieldFact) {
            return out;
        }
    }

    for (const nodeId of pagNodes.values()) {
        add(new TaintFact(pag.getNode(nodeId) as any, sourceTag, contextId));
    }
    return out;
}

function matchesScope(method: ArkMethod, scope?: RuleScopeConstraint): boolean {
    if (!scope) return true;
    const sig = method.getSignature().toString();
    const filePath = extractFilePathFromSignature(sig);
    const classText = method.getDeclaringArkClass()?.getName?.() || sig;
    const moduleText = filePath || sig;

    if (!matchStringConstraint(scope.file, filePath)) return false;
    if (!matchStringConstraint(scope.module, moduleText)) return false;
    if (!matchStringConstraint(scope.className, classText)) return false;
    if (!matchStringConstraint(scope.methodName, method.getName())) return false;
    return true;
}

function extractFilePathFromSignature(signature: string): string {
    const m = signature.match(/@([^:>]+):/);
    return m ? m[1].replace(/\\/g, "/") : signature;
}

function matchStringConstraint(constraint: RuleStringConstraint | undefined, text: string): boolean {
    if (!constraint) return true;
    const value = constraint.value || "";
    if (constraint.mode === "equals") return text === value;
    if (constraint.mode === "contains") return text.includes(value);
    try {
        return new RegExp(value).test(text);
    } catch {
        return false;
    }
}

function toRecord(map: Map<string, number>): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        out[k] = v;
    }
    return out;
}
