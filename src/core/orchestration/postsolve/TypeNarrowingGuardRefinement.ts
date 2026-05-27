import { ArkIfStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import {
    ArkConditionExpr,
    ArkNormalBinopExpr,
    ArkTypeOfExpr,
    RelationalBinaryOperator,
} from "../../../../arkanalyzer/out/src/core/base/Expr";
import {
    BigIntType,
    BooleanType,
    LiteralType,
    NumberType,
    PrimitiveType,
    StringType,
    Type,
    UndefinedType,
    UnionType,
    UnknownType,
} from "../../../../arkanalyzer/out/src/core/base/Type";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import { ArkParameterRef } from "../../../../arkanalyzer/out/src/core/base/Ref";
import {
    BigIntConstant,
    BooleanConstant,
    Constant,
    NullConstant,
    NumberConstant,
    StringConstant,
    UndefinedConstant,
} from "../../../../arkanalyzer/out/src/core/base/Constant";
import { TaintFlow } from "../../kernel/model/TaintFlow";
import {
    PostsolveContext,
    PostsolveEvidence,
    TaintFactWitness,
    TypeofDeadBranchEvidence,
    TypeofGuardFormula,
    TypeofGuardObligation,
    TypeofTag,
} from "./PostsolveTypes";
import { ProvenancePath } from "../../provenance/ProvenancePathTypes";
import { FactPredecessorRecord } from "../../kernel/propagation/PropagationTypes";

const ALL_TYPEOF_TAGS: TypeofTag[] = [
    "string",
    "number",
    "boolean",
    "bigint",
    "undefined",
    "object",
    "function",
];

export function evaluateTypeNarrowingGuardPath(
    flow: TaintFlow,
    path: ProvenancePath,
    context: PostsolveContext,
): PostsolveEvidence[] {
    if (path.truncated) return [];
    const witness = buildWitnessFromPath(path, context);
    if (!witness || witness.facts.length === 0) return [];
    const evidence = evaluateProvenanceFactPath(flow, witness);
    if (!evidence) return [];
    return [toPostsolveEvidence(flow, path, evidence)];
}

function buildWitnessFromPath(path: { factIds: string[]; edges: { fromFactId: string; toFactId: string; reason: string }[] }, context: PostsolveContext): TaintFactWitness | undefined {
    const facts = path.factIds
        .map(factId => context.observedFactsById.get(factId))
        .filter((fact): fact is NonNullable<typeof fact> => !!fact);
    if (facts.length === 0) return undefined;
    const predecessorRecords: FactPredecessorRecord[] = path.edges.map(edge => ({
        fromFactId: edge.fromFactId,
        toFactId: edge.toFactId,
        reason: edge.reason,
    }));
    return { facts, predecessorRecords };
}

function evaluateProvenanceFactPath(
    flow: TaintFlow,
    witness: TaintFactWitness,
): TypeofDeadBranchEvidence | undefined {
    const obligations = collectTypeofGuardObligations(flow, witness);
    if (obligations.length === 0) return undefined;

    const pathStateByMethod = new Map<string, Map<string, Set<TypeofTag>>>();
    let deadEvidence: TypeofDeadBranchEvidence | undefined;
    for (const obligation of obligations) {
        const methodSig = resolveMethodSignatureTextFromStmt(obligation.stmt);
        const state = pathStateByMethod.get(methodSig) || new Map<string, Set<TypeofTag>>();
        if (!pathStateByMethod.has(methodSig)) {
            pathStateByMethod.set(methodSig, state);
        }
        const possibleTypes = collectPossibleTypesForVariable(obligation.variable, obligation.variableKey, state);
        if (possibleTypes.size === 0 || possibleTypes.has("unknown")) {
            return undefined;
        }
        if (isDeadBranch(obligation, possibleTypes)) {
            const allowedTypes = [...obligation.allowedTypes].sort();
            const actualTypes = [...possibleTypes].sort();
            deadEvidence = {
                kind: "type_narrowing_guard",
                branchTaken: obligation.branchTaken,
                variableName: obligation.variableName,
                allowedTypes,
                possibleTypes: actualTypes,
                guardText: obligation.guardText,
                reason: `type_narrowing_guard:${obligation.branchTaken}_branch_dead:${allowedTypes.join("_")}_vs_${actualTypes.join("_")}`,
            };
            continue;
        }
        refinePathState(state, obligation, possibleTypes);
    }
    return deadEvidence;
}

function collectTypeofGuardObligations(flow: TaintFlow, witness: TaintFactWitness): TypeofGuardObligation[] {
    const sinkStmt = flow.sink as any;
    if (!sinkStmt) return [];

    const witnessBlocksByMethod = buildWitnessBlocksByMethod(flow, witness);
    if (witnessBlocksByMethod.size === 0) return [];

    const obligations: TypeofGuardObligation[] = [];
    for (const [methodSig, witnessBlocks] of witnessBlocksByMethod.entries()) {
        const method = resolveMethodForSignature(sinkStmt, methodSig);
        const cfg = method?.getCfg?.();
        const blocks = cfg?.getBlocks?.() ? [...cfg.getBlocks()] : [];
        for (const block of blocks) {
            const tail = block?.getTail?.();
            if (!(tail instanceof ArkIfStmt)) continue;
            const branchResolution = resolveBranchTakenForWitnessBlocks(block, witnessBlocks);
            if (!branchResolution) continue;
            if (!blockDominatesTarget(cfg, block, branchResolution.targetBlock)) continue;
            const formula = parseTypeofGuardFormula(tail.getConditionExpr?.());
            if (!formula) continue;
            obligations.push({
                stmt: tail,
                methodSignature: methodSig,
                variableName: formula.variableName,
                variableKey: formula.variableKey,
                variable: formula.variable,
                allowedTypes: new Set(formula.allowedTypes),
                branchTaken: branchResolution.branchTaken,
                guardText: tail.getOriginalText?.() || tail.toString?.() || "",
                witnessPosition: tail.getOriginPositionInfo?.()?.getLineNo?.() ?? Number.MAX_SAFE_INTEGER,
            });
        }
    }

    return obligations.sort(compareGuardOrder);
}

function buildWitnessBlocksByMethod(flow: TaintFlow, witness: TaintFactWitness): Map<string, Set<any>> {
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
    for (const fact of witness.facts) {
        const stmt = resolveAnchorStmtFromFact(fact);
        if (!stmt) continue;
        pushBlock(stmt);
    }
    return out;
}

function resolveMethodForSignature(anchorStmt: any, methodSig: string): any | undefined {
    const scene = anchorStmt?.getCfg?.()?.getDeclaringMethod?.()?.getDeclaringArkFile?.()?.getScene?.()
        || anchorStmt?.getCfg?.()?.getDeclaringMethod?.()?.getDeclaringArkClass?.()?.getDeclaringArkFile?.()?.getScene?.();
    if (!scene || typeof scene.getMethods !== "function") return undefined;
    for (const method of scene.getMethods()) {
        const currentSig = method?.getSignature?.()?.toString?.() || "";
        if (currentSig !== methodSig) continue;
        return method;
    }
    return undefined;
}

function compareGuardOrder(left: TypeofGuardObligation, right: TypeofGuardObligation): number {
    const leftLine = left.witnessPosition;
    const rightLine = right.witnessPosition;
    if (leftLine !== rightLine) return leftLine - rightLine;
    const leftCol = left.stmt?.getOriginPositionInfo?.()?.getColNo?.() ?? Number.MAX_SAFE_INTEGER;
    const rightCol = right.stmt?.getOriginPositionInfo?.()?.getColNo?.() ?? Number.MAX_SAFE_INTEGER;
    return leftCol - rightCol;
}

function resolveMethodSignatureTextFromFact(fact: any): string {
    const stmt = resolveAnchorStmtFromFact(fact);
    return stmt?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.() || "";
}

function resolveMethodSignatureTextFromStmt(stmt: any): string {
    return stmt?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.() || "";
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
        if (resolved.branchTaken !== branchTaken) {
            return undefined;
        }
    }
    if (resolved) return resolved;
    const trueHits = hasReachableWitnessBlock(successors[0], witnessBlocks);
    const falseHits = hasReachableWitnessBlock(successors[1], witnessBlocks);
    if (trueHits && !falseHits) return { branchTaken: "true", targetBlock: firstWitnessBlock(witnessBlocks) };
    if (falseHits && !trueHits) return { branchTaken: "false", targetBlock: firstWitnessBlock(witnessBlocks) };
    return undefined;
}

function firstWitnessBlock(witnessBlocks: Set<any>): any | undefined {
    for (const block of witnessBlocks) return block;
    return undefined;
}

function hasReachableWitnessBlock(start: any, witnessBlocks: Set<any>): boolean {
    if (!start || witnessBlocks.size === 0) return false;
    const queue = [start];
    const visited = new Set<any>([start]);
    while (queue.length > 0) {
        const current = queue.shift();
        if (witnessBlocks.has(current)) return true;
        const successors = current?.getSuccessors?.() || [];
        for (const next of successors) {
            if (!next || visited.has(next)) continue;
            visited.add(next);
            queue.push(next);
        }
    }
    return false;
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
        if (current === target) {
            return false;
        }
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
    if (value instanceof Local) {
        return value.getDeclaringStmt?.();
    }
    return undefined;
}

function parseTypeofGuardFormula(expr: any): TypeofGuardFormula | undefined {
    return parseAllowedTypesFormula(expr);
}

function parseAllowedTypesFormula(expr: any): TypeofGuardFormula | undefined {
    if (expr instanceof Local) {
        return resolveBooleanGuardSource(expr);
    }
    if (!(expr instanceof ArkConditionExpr) && !(expr instanceof ArkNormalBinopExpr)) return undefined;
    const operator = String(expr.getOperator?.() || "").trim();

    if (operator === "||") {
        const left = parseAllowedTypesOperand(expr.getOp1?.());
        const right = parseAllowedTypesOperand(expr.getOp2?.());
        if (!left || !right || left.variableName !== right.variableName) return undefined;
        return {
            variable: left.variable,
            variableName: left.variableName,
            variableKey: left.variableKey,
            allowedTypes: new Set<TypeofTag>([...left.allowedTypes, ...right.allowedTypes]),
        };
    }

    if (operator === "&&") {
        const left = parseAllowedTypesOperand(expr.getOp1?.());
        const right = parseAllowedTypesOperand(expr.getOp2?.());
        if (!left || !right || left.variableName !== right.variableName) return undefined;
        return {
            variable: left.variable,
            variableName: left.variableName,
            variableKey: left.variableKey,
            allowedTypes: intersectTypeSets(left.allowedTypes, right.allowedTypes),
        };
    }

    return parseAtomicAllowedTypesFormula(expr);
}

function toPostsolveEvidence(
    flow: TaintFlow,
    path: ProvenancePath,
    evidence: TypeofDeadBranchEvidence,
): PostsolveEvidence {
    return {
        kind: "type_narrowing_guard",
        polarity: "negative",
        strength: "strong",
        stability: "overridable",
        scope: "path",
        subject: {
            pathId: path.id,
            sinkFactId: flow.sinkFactId,
            sinkNodeId: flow.sinkNodeId,
        },
        requiredForRefutation: true,
        preconditions: {
            pathComplete: path.status === "complete" || path.status === "bounded-complete",
            sameValueVersion: true,
        },
        sourceEvidenceIds: [path.id].filter((id): id is string => !!id),
        target: {
            sinkFactId: flow.sinkFactId || "",
            sinkNodeId: flow.sinkNodeId,
        },
        meta: {
            branchTaken: evidence.branchTaken,
            variableName: evidence.variableName,
            allowedTypes: evidence.allowedTypes,
            possibleTypes: evidence.possibleTypes,
            guardText: evidence.guardText,
            reason: evidence.reason,
        },
    };
}

function parseAllowedTypesOperand(value: any): TypeofGuardFormula | undefined {
    if (value instanceof Local) {
        return resolveBooleanGuardSource(value);
    }
    return parseAllowedTypesFormula(value);
}

function parseAtomicAllowedTypesFormula(expr: any): TypeofGuardFormula | undefined {
    const operator = String(expr.getOperator?.() || "").trim();
    if (operator !== RelationalBinaryOperator.StrictEquality
        && operator !== RelationalBinaryOperator.Equality
        && operator !== "=="
        && operator !== "===") {
        return parseAtomicForbiddenTypesFormula(expr)
            || parseBooleanTempGuardFormula(expr);
    }
    return parseTypeofValueAndLiteral(expr.getOp1?.(), expr.getOp2?.())
        || parseTypeofValueAndLiteral(expr.getOp2?.(), expr.getOp1?.());
}

function parseBooleanTempGuardFormula(expr: any): TypeofGuardFormula | undefined {
    if (!(expr instanceof ArkConditionExpr) && !(expr instanceof ArkNormalBinopExpr)) return undefined;
    const operator = String(expr.getOperator?.() || "").trim();
    if (
        operator !== RelationalBinaryOperator.StrictEquality
        && operator !== RelationalBinaryOperator.Equality
        && operator !== RelationalBinaryOperator.StrictInequality
        && operator !== RelationalBinaryOperator.InEquality
        && operator !== "=="
        && operator !== "==="
        && operator !== "!="
        && operator !== "!=="
    ) {
        return undefined;
    }

    const left = expr.getOp1?.();
    const right = expr.getOp2?.();
    const leftResolved = resolveBooleanGuardSource(left);
    const rightResolved = resolveBooleanGuardSource(right);

    if (leftResolved && isBooleanLiteral(right)) {
        return normalizeBooleanTempFormula(leftResolved, operator, booleanLiteralValue(right));
    }
    if (rightResolved && isBooleanLiteral(left)) {
        return normalizeBooleanTempFormula(rightResolved, operator, booleanLiteralValue(left));
    }
    return undefined;
}

function resolveBooleanGuardSource(value: any, visitedLocals: Set<Local> = new Set()): TypeofGuardFormula | undefined {
    if (!(value instanceof Local)) return undefined;
    if (visitedLocals.has(value)) return undefined;
    visitedLocals.add(value);
    const declStmt: any = value.getDeclaringStmt?.();
    if (!declStmt || declStmt.getLeftOp?.() !== value) return undefined;
    const right = declStmt.getRightOp?.();
    if (!right) return undefined;
    const parsed = parseAllowedTypesFormula(right);
    if (parsed) return parsed;
    if (right instanceof Local) {
        return resolveBooleanGuardSource(right, visitedLocals);
    }
    return undefined;
}

function normalizeBooleanTempFormula(
    source: TypeofGuardFormula,
    operator: string,
    literalValue: boolean,
): TypeofGuardFormula | undefined {
    const conditionIsTruthy = (
        (operator === RelationalBinaryOperator.StrictEquality || operator === RelationalBinaryOperator.Equality || operator === "==" || operator === "===") && literalValue
    ) || (
        (operator === RelationalBinaryOperator.StrictInequality || operator === RelationalBinaryOperator.InEquality || operator === "!=" || operator === "!==") && literalValue
    );
    const conditionIsFalsy = (
        (operator === RelationalBinaryOperator.StrictEquality || operator === RelationalBinaryOperator.Equality || operator === "==" || operator === "===") && !literalValue
    ) || (
        (operator === RelationalBinaryOperator.StrictInequality || operator === RelationalBinaryOperator.InEquality || operator === "!=" || operator === "!==") && !literalValue
    );
    if (!conditionIsTruthy && !conditionIsFalsy) return undefined;
    return {
        variable: source.variable,
        variableName: source.variableName,
        variableKey: source.variableKey,
        allowedTypes: conditionIsTruthy ? new Set(source.allowedTypes) : complementTypeofTags(source.allowedTypes),
    };
}

function isBooleanLiteral(value: any): boolean {
    return value instanceof BooleanConstant
        || String(value?.toString?.() || "").trim() === "true"
        || String(value?.toString?.() || "").trim() === "false";
}

function booleanLiteralValue(value: any): boolean {
    if (value instanceof BooleanConstant) {
        return !!value.getValue?.();
    }
    return String(value?.toString?.() || "").trim() === "true";
}

function parseAtomicForbiddenTypesFormula(expr: any): TypeofGuardFormula | undefined {
    const operator = String(expr.getOperator?.() || "").trim();
    if (operator !== RelationalBinaryOperator.StrictInequality
        && operator !== RelationalBinaryOperator.InEquality
        && operator !== "!="
        && operator !== "!==") {
        return undefined;
    }
    const parsed = parseTypeofValueAndLiteral(expr.getOp1?.(), expr.getOp2?.())
        || parseTypeofValueAndLiteral(expr.getOp2?.(), expr.getOp1?.());
    if (!parsed) return undefined;
    return {
        variable: parsed.variable,
        variableName: parsed.variableName,
        variableKey: parsed.variableKey,
        allowedTypes: complementTypeofTags(parsed.allowedTypes),
    };
}

function parseTypeofValueAndLiteral(typeOfCandidate: any, literalCandidate: any): TypeofGuardFormula | undefined {
    if (!(typeOfCandidate instanceof ArkTypeOfExpr)) return undefined;
    const op = typeOfCandidate.getOp?.();
    if (!(op instanceof Local)) return undefined;
    const literal = extractTypeofLiteral(literalCandidate);
    if (!literal) return undefined;
    return {
        variable: op,
        variableName: op.getName(),
        variableKey: buildVariableKey(op),
        allowedTypes: new Set<TypeofTag>([literal]),
    };
}

function extractTypeofLiteral(value: any): TypeofTag | undefined {
    const raw = value instanceof StringConstant
        ? String(value.getValue?.() || value.toString?.() || "").trim()
        : String(value?.toString?.() || "").trim().replace(/^['"`]|['"`]$/g, "");
    switch (raw) {
        case "string":
        case "number":
        case "boolean":
        case "bigint":
        case "undefined":
        case "object":
        case "function":
            return raw;
        default:
            return undefined;
    }
}

function collectPossibleTypesForVariable(
    variable: Local | undefined,
    variableKey: string,
    pathState: Map<string, Set<TypeofTag>>,
): Set<TypeofTag> {
    const pathNarrowed = pathState.get(variableKey);
    if (pathNarrowed && pathNarrowed.size > 0) {
        return new Set(pathNarrowed);
    }

    if (!variable) return new Set<TypeofTag>(["unknown"]);

    const fromDecl = collectTypesFromDecl(variable, new Set<Local>());
    if (fromDecl.size > 0) return fromDecl;

    const fromType = collectTypesFromType(variable.getType?.());
    if (fromType.size > 0) return fromType;

    return new Set<TypeofTag>(["unknown"]);
}

function collectTypesFromDecl(local: Local, visitedLocals: Set<Local>): Set<TypeofTag> {
    if (visitedLocals.has(local)) return new Set<TypeofTag>();
    visitedLocals.add(local);
    const stmt: any = local.getDeclaringStmt?.();
    if (!stmt || stmt.getLeftOp?.() !== local) return new Set<TypeofTag>();
    const right = stmt.getRightOp?.();
    return collectTypesFromValue(right, visitedLocals);
}

function collectTypesFromValue(value: any, visitedLocals: Set<Local>): Set<TypeofTag> {
    if (!value) return new Set<TypeofTag>();
    if (value instanceof StringConstant) return new Set<TypeofTag>(["string"]);
    if (value instanceof NumberConstant) return new Set<TypeofTag>(["number"]);
    if (value instanceof BooleanConstant) return new Set<TypeofTag>(["boolean"]);
    if (value instanceof BigIntConstant) return new Set<TypeofTag>(["bigint"]);
    if (value instanceof UndefinedConstant) return new Set<TypeofTag>(["undefined"]);
    if (value instanceof NullConstant) return new Set<TypeofTag>(["object"]);

    const text = String(value?.toString?.() || "").trim();
    if (text === "true" || text === "false") return new Set<TypeofTag>(["boolean"]);
    if (/^-?\d+(\.\d+)?$/.test(text)) return new Set<TypeofTag>(["number"]);
    if (/^-?\d+n$/.test(text)) return new Set<TypeofTag>(["bigint"]);
    if (text === "undefined") return new Set<TypeofTag>(["undefined"]);

    if (value instanceof Local) {
        const fromDecl = collectTypesFromDecl(value, visitedLocals);
        if (fromDecl.size > 0) return fromDecl;
        const fromType = collectTypesFromType(value.getType?.());
        if (fromType.size > 0) return fromType;
    }

    return new Set<TypeofTag>();
}

function collectTypesFromType(type: Type | undefined): Set<TypeofTag> {
    if (!type) return new Set<TypeofTag>();
    if (type instanceof StringType) return new Set<TypeofTag>(["string"]);
    if (type instanceof NumberType) return new Set<TypeofTag>(["number"]);
    if (type instanceof BooleanType) return new Set<TypeofTag>(["boolean"]);
    if (type instanceof BigIntType) return new Set<TypeofTag>(["bigint"]);
    if (type instanceof UndefinedType) return new Set<TypeofTag>(["undefined"]);

    if (type instanceof LiteralType) {
        const literal = type.getLiteralName?.();
        if (typeof literal === "string") return new Set<TypeofTag>(["string"]);
        if (typeof literal === "number") return new Set<TypeofTag>(["number"]);
        if (typeof literal === "boolean") return new Set<TypeofTag>(["boolean"]);
    }

    if (type instanceof UnionType) {
        const out = new Set<TypeofTag>();
        for (const item of type.getTypes?.() || []) {
            for (const tag of collectTypesFromType(item)) out.add(tag);
        }
        return out;
    }

    if (type instanceof PrimitiveType) {
        const name = String(type.getName?.() || "").trim();
        if (name === "string" || name === "number" || name === "boolean" || name === "bigint" || name === "undefined") {
            return new Set<TypeofTag>([name as TypeofTag]);
        }
    }

    if (type instanceof UnknownType) return new Set<TypeofTag>(["unknown"]);

    const text = String(type.toString?.() || "").trim();
    if (text === "string") return new Set<TypeofTag>(["string"]);
    if (text === "number") return new Set<TypeofTag>(["number"]);
    if (text === "boolean") return new Set<TypeofTag>(["boolean"]);
    if (text === "bigint") return new Set<TypeofTag>(["bigint"]);
    if (text === "undefined") return new Set<TypeofTag>(["undefined"]);
    if (text === "unknown" || text === "any") return new Set<TypeofTag>(["unknown"]);

    return new Set<TypeofTag>();
}

function complementTypeofTags(excluded: Set<TypeofTag>): Set<TypeofTag> {
    return new Set<TypeofTag>(ALL_TYPEOF_TAGS.filter(item => !excluded.has(item)));
}

function isDeadBranch(obligation: TypeofGuardObligation, possibleTypes: Set<TypeofTag>): boolean {
    const intersection = [...possibleTypes].filter(item => obligation.allowedTypes.has(item));
    if (obligation.branchTaken === "true") {
        return intersection.length === 0;
    }
    return intersection.length === possibleTypes.size;
}

function refinePathState(
    state: Map<string, Set<TypeofTag>>,
    obligation: TypeofGuardObligation,
    currentPossibleTypes: Set<TypeofTag>,
): void {
    const narrowed = obligation.branchTaken === "true"
        ? intersectTypeSets(currentPossibleTypes, obligation.allowedTypes)
        : subtractTypeSets(currentPossibleTypes, obligation.allowedTypes);
    if (narrowed.size === 0) return;
    state.set(obligation.variableKey, narrowed);
}

function intersectTypeSets(left: Set<TypeofTag>, right: Set<TypeofTag>): Set<TypeofTag> {
    const out = new Set<TypeofTag>();
    for (const item of left) {
        if (right.has(item)) out.add(item);
    }
    return out;
}

function subtractTypeSets(left: Set<TypeofTag>, right: Set<TypeofTag>): Set<TypeofTag> {
    const out = new Set<TypeofTag>();
    for (const item of left) {
        if (!right.has(item)) out.add(item);
    }
    return out;
}

function buildVariableKey(local: Local): string {
    const decl = local.getDeclaringStmt?.();
    const line = decl?.getOriginPositionInfo?.()?.getLineNo?.() ?? -1;
    const stmtText = decl?.toString?.() || "";
    return `${local.getName()}#${line}#${stmtText}`;
}
