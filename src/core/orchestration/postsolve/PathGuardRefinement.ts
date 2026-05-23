import { ArkIfStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import {
    ArkConditionExpr,
    ArkNormalBinopExpr,
    RelationalBinaryOperator,
} from "../../../../arkanalyzer/out/src/core/base/Expr";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import {
    BooleanConstant,
    Constant,
    NumberConstant,
    StringConstant,
} from "../../../../arkanalyzer/out/src/core/base/Constant";
import { TaintFlow } from "../../kernel/model/TaintFlow";
import { ProvenancePath } from "../../provenance/ProvenancePathTypes";
import { PostsolveContext, PostsolveEvidence } from "./PostsolveTypes";
import { hasLocalReassignmentBetween } from "./PostsolveRuleUtils";

type LiteralRelation = "eq" | "neq";

interface LiteralPathGuardFormula {
    variable: Local;
    variableName: string;
    variableKey: string;
    relation: LiteralRelation;
    literalKey: string;
    literalText: string;
}

interface LiteralPathGuardObligation extends LiteralPathGuardFormula {
    stmt: any;
    methodSignature: string;
    branchTaken: "true" | "false";
    guardText: string;
    stmtIndex: number;
}

interface LiteralPathGuardState {
    variable: Local;
    equalLiteral?: string;
    equalText?: string;
    equalGuardText?: string;
    notEqualLiterals: Map<string, string>;
    notEqualGuardTexts: Map<string, string>;
    lastStmtIndex: number;
}

export function evaluatePathGuardPath(
    flow: TaintFlow,
    path: ProvenancePath,
    context: PostsolveContext,
): PostsolveEvidence[] {
    if (path.truncated || path.status === "incomplete") return [];
    const obligations = collectLiteralPathGuardObligations(flow, path, context);
    if (obligations.length === 0) return [];

    const stateByMethodAndVariable = new Map<string, LiteralPathGuardState>();
    for (const obligation of obligations) {
        const method = resolveMethodForSignature(flow.sink, obligation.methodSignature);
        const stmts = method?.getCfg?.()?.getStmts?.() || [];
        const stateKey = `${obligation.methodSignature}::${obligation.variableKey}`;
        let state = stateByMethodAndVariable.get(stateKey);
        if (state && hasLocalReassignmentBetween(stmts, obligation.variable, state.lastStmtIndex, obligation.stmtIndex)) {
            state = undefined;
            stateByMethodAndVariable.delete(stateKey);
        }
        if (!state) {
            state = {
                variable: obligation.variable,
                notEqualLiterals: new Map<string, string>(),
                notEqualGuardTexts: new Map<string, string>(),
                lastStmtIndex: obligation.stmtIndex,
            };
            stateByMethodAndVariable.set(stateKey, state);
        }

        const conflict = findLiteralConflict(state, obligation);
        if (conflict) {
            return [buildPathGuardEvidence(flow, obligation, conflict)];
        }

        applyLiteralObligation(state, obligation);
    }

    return [];
}

function findLiteralConflict(
    state: LiteralPathGuardState,
    obligation: LiteralPathGuardObligation,
): {
    previousGuardText?: string;
    previousRelation: LiteralRelation;
    previousLiteralText: string;
} | undefined {
    if (obligation.relation === "eq") {
        if (state.equalLiteral && state.equalLiteral !== obligation.literalKey) {
            return {
                previousGuardText: state.equalGuardText,
                previousRelation: "eq",
                previousLiteralText: state.equalText || state.equalLiteral,
            };
        }
        const notEqualText = state.notEqualLiterals.get(obligation.literalKey);
        if (notEqualText !== undefined) {
            return {
                previousGuardText: state.notEqualGuardTexts.get(obligation.literalKey),
                previousRelation: "neq",
                previousLiteralText: notEqualText,
            };
        }
    }
    if (obligation.relation === "neq" && state.equalLiteral === obligation.literalKey) {
        return {
            previousGuardText: state.equalGuardText,
            previousRelation: "eq",
            previousLiteralText: state.equalText || state.equalLiteral,
        };
    }
    return undefined;
}

function applyLiteralObligation(
    state: LiteralPathGuardState,
    obligation: LiteralPathGuardObligation,
): void {
    if (obligation.relation === "eq") {
        state.equalLiteral = obligation.literalKey;
        state.equalText = obligation.literalText;
        state.equalGuardText = obligation.guardText;
        state.notEqualLiterals.clear();
        state.notEqualGuardTexts.clear();
    } else {
        state.notEqualLiterals.set(obligation.literalKey, obligation.literalText);
        state.notEqualGuardTexts.set(obligation.literalKey, obligation.guardText);
    }
    state.lastStmtIndex = obligation.stmtIndex;
}

function buildPathGuardEvidence(
    flow: TaintFlow,
    obligation: LiteralPathGuardObligation,
    conflict: {
        previousGuardText?: string;
        previousRelation: LiteralRelation;
        previousLiteralText: string;
    },
): PostsolveEvidence {
    return {
        kind: "path_guard",
        polarity: "negative",
        strength: "strong",
        stability: "overridable",
        position: {
            stmtText: obligation.guardText,
            methodSignature: obligation.methodSignature,
        },
        target: {
            sinkFactId: flow.sinkFactId || "",
            sinkNodeId: flow.sinkNodeId,
        },
        meta: {
            reason: "path_guard:literal_constraint_conflict",
            variableName: obligation.variableName,
            currentRelation: obligation.relation,
            currentLiteral: obligation.literalText,
            currentGuardText: obligation.guardText,
            previousRelation: conflict.previousRelation,
            previousLiteral: conflict.previousLiteralText,
            previousGuardText: conflict.previousGuardText || "",
        },
    };
}

function collectLiteralPathGuardObligations(
    flow: TaintFlow,
    path: ProvenancePath,
    context: PostsolveContext,
): LiteralPathGuardObligation[] {
    const witnessBlocksByMethod = buildWitnessBlocksByMethod(flow, path, context);
    if (witnessBlocksByMethod.size === 0) return [];

    const obligations: LiteralPathGuardObligation[] = [];
    for (const [methodSig, witnessBlocks] of witnessBlocksByMethod.entries()) {
        const method = resolveMethodForSignature(flow.sink, methodSig);
        const cfg = method?.getCfg?.();
        const blocks = cfg?.getBlocks?.() ? [...cfg.getBlocks()] : [];
        const stmts = cfg?.getStmts?.() || [];
        for (const block of blocks) {
            const tail = block?.getTail?.();
            if (!(tail instanceof ArkIfStmt)) continue;
            const branchResolution = resolveBranchTakenForWitnessBlocks(block, witnessBlocks);
            if (!branchResolution) continue;
            if (!blockDominatesTarget(cfg, block, branchResolution.targetBlock)) continue;
            const parsed = parseLiteralPathGuardFormula(tail.getConditionExpr?.());
            if (!parsed) continue;
            const effective = branchResolution.branchTaken === "true" ? parsed : invertLiteralFormula(parsed);
            const stmtIndex = stmts.indexOf(tail);
            if (stmtIndex < 0) continue;
            obligations.push({
                ...effective,
                stmt: tail,
                methodSignature: methodSig,
                branchTaken: branchResolution.branchTaken,
                guardText: tail.getOriginalText?.() || tail.toString?.() || "",
                stmtIndex,
            });
        }
    }

    return obligations.sort(compareLiteralObligations);
}

function buildWitnessBlocksByMethod(
    flow: TaintFlow,
    path: ProvenancePath,
    context: PostsolveContext,
): Map<string, Set<any>> {
    const out = new Map<string, Set<any>>();
    const pushBlock = (stmt: any): void => {
        const block = findOwningBlock(stmt);
        const methodSig = resolveMethodSignatureTextFromStmt(stmt);
        if (!block || !methodSig) return;
        const bucket = out.get(methodSig) || new Set<any>();
        if (!out.has(methodSig)) out.set(methodSig, bucket);
        bucket.add(block);
    };

    pushBlock(flow.sink);
    for (const factId of path.factIds) {
        const fact = context.observedFactsById.get(factId);
        const stmt = resolveAnchorStmtFromFact(fact);
        if (!stmt) continue;
        pushBlock(stmt);
    }
    return out;
}

function resolveBranchTakenForWitnessBlocks(
    guardBlock: any,
    witnessBlocks: Set<any>,
): { branchTaken: "true" | "false"; targetBlock: any } | undefined {
    const successors = guardBlock?.getSuccessors?.() || [];
    if (successors.length !== 2) return undefined;
    let resolved: { branchTaken: "true" | "false"; targetBlock: any } | undefined;
    for (const witnessBlock of witnessBlocks) {
        const trueHits = isBlockReachable(successors[0], witnessBlock);
        const falseHits = isBlockReachable(successors[1], witnessBlock);
        if (trueHits === falseHits) continue;
        const branchTaken = trueHits ? "true" : "false";
        if (!resolved) {
            resolved = { branchTaken, targetBlock: witnessBlock };
            continue;
        }
        if (resolved.branchTaken !== branchTaken) return undefined;
    }
    return resolved;
}

function isBlockReachable(start: any, target: any): boolean {
    if (!start || !target) return false;
    const queue = [start];
    const visited = new Set<any>([start]);
    while (queue.length > 0) {
        const current = queue.shift();
        if (current === target) return true;
        const successors = current?.getSuccessors?.() || [];
        for (const next of successors) {
            if (!next || visited.has(next)) continue;
            visited.add(next);
            queue.push(next);
        }
    }
    return false;
}

function blockDominatesTarget(cfg: any, dominator: any, target: any): boolean {
    if (!cfg || !dominator || !target) return false;
    if (dominator === target) return true;
    const start = cfg.getStartingBlock?.();
    if (!start) return false;
    if (start === dominator) return true;
    const queue = [start];
    const visited = new Set<any>([start]);
    while (queue.length > 0) {
        const current = queue.shift();
        if (current === target) return false;
        const successors = current?.getSuccessors?.() || [];
        for (const next of successors) {
            if (!next || next === dominator || visited.has(next)) continue;
            visited.add(next);
            queue.push(next);
        }
    }
    return true;
}

function findOwningBlock(stmt: any): any | undefined {
    const cfg = stmt?.getCfg?.();
    const blocks = cfg?.getBlocks?.() || [];
    for (const block of blocks) {
        const stmts = block?.getStmts?.() || [];
        if (stmts.includes(stmt)) return block;
    }
    return undefined;
}

function resolveAnchorStmtFromFact(fact: any): any | undefined {
    const nodeStmt = fact?.node?.getStmt?.();
    if (nodeStmt) return nodeStmt;
    const value = fact?.node?.getValue?.();
    if (value instanceof Local) return value.getDeclaringStmt?.();
    return undefined;
}

function resolveMethodForSignature(anchorStmt: any, methodSig: string): any | undefined {
    const scene = anchorStmt?.getCfg?.()?.getDeclaringMethod?.()?.getDeclaringArkFile?.()?.getScene?.()
        || anchorStmt?.getCfg?.()?.getDeclaringMethod?.()?.getDeclaringArkClass?.()?.getDeclaringArkFile?.()?.getScene?.();
    if (!scene || typeof scene.getMethods !== "function") return undefined;
    for (const method of scene.getMethods()) {
        const currentSig = method?.getSignature?.()?.toString?.() || "";
        if (currentSig === methodSig) return method;
    }
    return undefined;
}

function resolveMethodSignatureTextFromStmt(stmt: any): string {
    return stmt?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.() || "";
}

function parseLiteralPathGuardFormula(expr: any): LiteralPathGuardFormula | undefined {
    if (!(expr instanceof ArkConditionExpr) && !(expr instanceof ArkNormalBinopExpr)) return undefined;
    const operator = String(expr.getOperator?.() || "").trim();
    const relation = normalizeRelation(operator);
    if (!relation) return undefined;
    const parsed = parseLocalLiteralPair(expr.getOp1?.(), expr.getOp2?.())
        || parseLocalLiteralPair(expr.getOp2?.(), expr.getOp1?.());
    if (!parsed) return undefined;
    return {
        ...parsed,
        relation,
    };
}

function normalizeRelation(operator: string): LiteralRelation | undefined {
    if (operator === RelationalBinaryOperator.StrictEquality
        || operator === RelationalBinaryOperator.Equality
        || operator === "=="
        || operator === "===") {
        return "eq";
    }
    if (operator === RelationalBinaryOperator.StrictInequality
        || operator === RelationalBinaryOperator.InEquality
        || operator === "!="
        || operator === "!==") {
        return "neq";
    }
    return undefined;
}

function parseLocalLiteralPair(
    localCandidate: any,
    literalCandidate: any,
): Omit<LiteralPathGuardFormula, "relation"> | undefined {
    if (!(localCandidate instanceof Local)) return undefined;
    const literal = literalFromValue(literalCandidate);
    if (!literal) return undefined;
    return {
        variable: localCandidate,
        variableName: localCandidate.getName?.() || "",
        variableKey: buildVariableKey(localCandidate),
        literalKey: literal.key,
        literalText: literal.text,
    };
}

function literalFromValue(value: any): { key: string; text: string } | undefined {
    if (value instanceof StringConstant) {
        const text = String(value.getValue?.() ?? value.toString?.() ?? "");
        return { key: `string:${text}`, text };
    }
    if (value instanceof NumberConstant) {
        const text = String(value.getValue?.() ?? value.toString?.() ?? "");
        return { key: `number:${text}`, text };
    }
    if (value instanceof BooleanConstant) {
        const text = String(value.getValue?.() ?? value.toString?.() ?? "");
        return { key: `boolean:${text}`, text };
    }
    if (value instanceof Constant) {
        const text = String(value.toString?.() || "").replace(/^['"`]|['"`]$/g, "");
        if (!text) return undefined;
        return { key: `constant:${text}`, text };
    }
    const raw = String(value?.toString?.() || "").trim();
    const quoted = raw.match(/^['"`]((?:\\.|[^'"`])*)['"`]$/);
    if (quoted) return { key: `string:${quoted[1]}`, text: quoted[1] };
    if (raw === "true" || raw === "false") return { key: `boolean:${raw}`, text: raw };
    if (/^-?\d+(\.\d+)?$/.test(raw)) return { key: `number:${raw}`, text: raw };
    return undefined;
}

function invertLiteralFormula(formula: LiteralPathGuardFormula): LiteralPathGuardFormula {
    return {
        ...formula,
        relation: formula.relation === "eq" ? "neq" : "eq",
    };
}

function compareLiteralObligations(left: LiteralPathGuardObligation, right: LiteralPathGuardObligation): number {
    if (left.methodSignature !== right.methodSignature) {
        return left.methodSignature.localeCompare(right.methodSignature);
    }
    if (left.stmtIndex !== right.stmtIndex) return left.stmtIndex - right.stmtIndex;
    return left.guardText.localeCompare(right.guardText);
}

function buildVariableKey(local: Local): string {
    const decl = local.getDeclaringStmt?.();
    const line = decl?.getOriginPositionInfo?.()?.getLineNo?.() ?? -1;
    const stmtText = decl?.toString?.() || "";
    return `${local.getName?.() || ""}#${line}#${stmtText}`;
}
