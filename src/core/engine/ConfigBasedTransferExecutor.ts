import { Pag, PagNode } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { Local } from "../../../arkanalyzer/out/src/core/base/Local";
import { ArkAssignStmt } from "../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkInstanceInvokeExpr, ArkStaticInvokeExpr } from "../../../arkanalyzer/out/src/core/base/Expr";
import { TaintFact } from "../TaintFact";
import { RuleEndpoint, TransferRule } from "../rules/RuleSchema";

interface RuntimeRule {
    rule: TransferRule;
    matchRegex?: RegExp;
}

interface InvokeSite {
    stmt: any;
    invokeExpr: ArkInstanceInvokeExpr | ArkStaticInvokeExpr;
    signature: string;
    methodName: string;
    baseValue?: any;
    resultValue?: any;
    args: any[];
}

export interface TransferExecutionResult {
    ruleId: string;
    callSignature: string;
    to: RuleEndpoint;
    fact: TaintFact;
}

export class ConfigBasedTransferExecutor {
    private readonly runtimeRules: RuntimeRule[];

    constructor(rules: TransferRule[] = []) {
        this.runtimeRules = this.compileRules(rules || []);
    }

    public executeFromTaintedLocal(
        taintedLocal: Local,
        source: string,
        contextID: number,
        pag: Pag
    ): TransferExecutionResult[] {
        if (this.runtimeRules.length === 0) return [];

        const sites = this.collectInvokeSites(taintedLocal);
        if (sites.length === 0) return [];

        const results: TransferExecutionResult[] = [];
        for (const site of sites) {
            for (const runtimeRule of this.runtimeRules) {
                if (!this.matchesRule(runtimeRule, site, taintedLocal)) continue;
                if (!this.endpointContainsLocal(runtimeRule.rule.from, site, taintedLocal)) continue;

                const targetValues = this.resolveEndpointValues(runtimeRule.rule.to, site);
                for (const targetValue of targetValues) {
                    if (!(targetValue instanceof Local)) continue;
                    const targetNodes = pag.getNodesByValue(targetValue);
                    if (!targetNodes) continue;

                    for (const nodeId of targetNodes.values()) {
                        const node = pag.getNode(nodeId) as PagNode;
                        results.push({
                            ruleId: runtimeRule.rule.id,
                            callSignature: site.signature,
                            to: runtimeRule.rule.to,
                            fact: new TaintFact(node, source, contextID),
                        });
                    }
                }
            }
        }

        return results;
    }

    private compileRules(rules: TransferRule[]): RuntimeRule[] {
        const out: RuntimeRule[] = [];
        for (const rule of rules) {
            let matchRegex: RegExp | undefined;
            const kind = rule.match.kind;
            if (
                (kind === "signature_regex" || kind === "method_name_regex" || kind === "local_name_regex")
                && typeof rule.match.value === "string"
            ) {
                try {
                    matchRegex = new RegExp(rule.match.value);
                } catch {
                    continue;
                }
            }
            out.push({ rule, matchRegex });
        }
        return out;
    }

    private collectInvokeSites(local: Local): InvokeSite[] {
        const out: InvokeSite[] = [];
        const seenStmts = new Set<any>();

        const pushIfInvokeSite = (stmt: any, resultCandidate?: any): void => {
            if (!stmt) return;
            if (seenStmts.has(stmt)) return;
            if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) return;
            const invokeExpr = stmt.getInvokeExpr();
            if (!(invokeExpr instanceof ArkInstanceInvokeExpr) && !(invokeExpr instanceof ArkStaticInvokeExpr)) return;

            const signature = invokeExpr.getMethodSignature?.()?.toString?.() || "";
            const methodNameFromSig = invokeExpr.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || "";
            let methodName = methodNameFromSig;
            if (!methodName && signature) {
                const match = signature.match(/\.([A-Za-z0-9_$]+)\(/);
                methodName = match ? match[1] : "";
            }

            const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
            const baseValue = invokeExpr instanceof ArkInstanceInvokeExpr ? invokeExpr.getBase() : undefined;
            let resultValue = resultCandidate;
            if (stmt instanceof ArkAssignStmt) {
                resultValue = stmt.getLeftOp();
            }

            seenStmts.add(stmt);
            out.push({
                stmt,
                invokeExpr,
                signature,
                methodName,
                baseValue,
                resultValue,
                args,
            });
        };

        for (const stmt of local.getUsedStmts()) {
            pushIfInvokeSite(stmt);
        }

        const declStmt = local.getDeclaringStmt();
        if (declStmt instanceof ArkAssignStmt) {
            const rightOp = declStmt.getRightOp();
            if (rightOp instanceof ArkInstanceInvokeExpr || rightOp instanceof ArkStaticInvokeExpr) {
                pushIfInvokeSite(declStmt, declStmt.getLeftOp());
            }
        }

        return out;
    }

    private matchesRule(runtimeRule: RuntimeRule, site: InvokeSite, local: Local): boolean {
        const rule = runtimeRule.rule;
        const value = rule.match.value || "";
        switch (rule.match.kind) {
            case "signature_contains":
                return site.signature.includes(value);
            case "signature_regex":
                return runtimeRule.matchRegex ? runtimeRule.matchRegex.test(site.signature) : false;
            case "method_name_equals":
                return site.methodName === value;
            case "method_name_regex":
                return runtimeRule.matchRegex ? runtimeRule.matchRegex.test(site.methodName) : false;
            case "local_name_regex":
                return runtimeRule.matchRegex ? runtimeRule.matchRegex.test(local.getName()) : false;
            default:
                return false;
        }
    }

    private endpointContainsLocal(endpoint: RuleEndpoint, site: InvokeSite, local: Local): boolean {
        if (endpoint === "base") return site.baseValue === local;
        if (endpoint === "result") return site.resultValue === local;
        const argIndex = this.parseArgIndex(endpoint);
        if (argIndex === null) return false;
        return site.args[argIndex] === local;
    }

    private resolveEndpointValues(endpoint: RuleEndpoint, site: InvokeSite): any[] {
        if (endpoint === "base") return site.baseValue !== undefined ? [site.baseValue] : [];
        if (endpoint === "result") return site.resultValue !== undefined ? [site.resultValue] : [];
        const argIndex = this.parseArgIndex(endpoint);
        if (argIndex === null) return [];
        const value = site.args[argIndex];
        return value !== undefined ? [value] : [];
    }

    private parseArgIndex(endpoint: RuleEndpoint): number | null {
        const match = /^arg(\d+)$/.exec(endpoint);
        if (!match) return null;
        const index = Number(match[1]);
        if (!Number.isFinite(index) || index < 0) return null;
        return index;
    }
}
