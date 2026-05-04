import { ArkAssignStmt, ArkIfStmt, ArkReturnStmt, ArkReturnVoidStmt, ArkThrowStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkMethod } from "../../../../arkanalyzer/out/src/core/model/ArkMethod";
import { BasicBlock } from "../../../../arkanalyzer/out/src/core/graph/BasicBlock";
import {
    SemanticCarrier,
    SemanticFact as SemanticFactType,
    SemanticPathAssumption,
    SemanticPathCondition,
    SemanticSolveInput,
    SemanticSolveResult,
    SemanticSolveResultMutable,
    SemanticTransition,
    SemanticTransitionContext,
    buildSemanticCarrierForValue,
    cloneSemanticFact,
    resolveMethodSignatureText,
    resolveStmtText,
} from "./SemanticStateTypes";
import { createNativeTransitions } from "./transitions/NativeTransitions";
import { createStorageTransitions } from "./transitions/StorageTransitions";
import { createEventTransitions } from "./transitions/EventTransitions";
import { createAsyncTransitions } from "./transitions/AsyncTransitions";
import { createStateSlotTransitions } from "./transitions/StateSlotTransitions";
import { createRouterTransitions } from "./transitions/RouterTransitions";

interface WorkItem {
    method: ArkMethod;
    block: BasicBlock;
    stmtIndex: number;
    facts: Map<string, SemanticFactType>;
    pathConditions: SemanticPathCondition[];
}

function buildCarrierFromValue(method: ArkMethod, value: any, stmt?: any): SemanticCarrier | undefined {
    return buildSemanticCarrierForValue(method, value, stmt);
}

function buildCarrierFromSeed(seed: SemanticFactType): SemanticCarrier {
    return {
        ...seed.carrier,
        key: seed.carrier.key,
    };
}

function cloneFactsMap(facts: Map<string, SemanticFactType>): Map<string, SemanticFactType> {
    const out = new Map<string, SemanticFactType>();
    for (const [key, fact] of facts.entries()) {
        out.set(key, cloneSemanticFact(fact));
    }
    return out;
}

function makeFactsKey(facts: Map<string, SemanticFactType>): string {
    return [...facts.values()]
        .map(f => `${f.carrier.key}:${f.tainted ? "T" : "F"}:${f.state}`)
        .sort()
        .join("|");
}

function makePathConditionsKey(pathConditions: SemanticPathCondition[]): string {
    return pathConditions
        .map(item => `${item.normalizedCondition}:${item.assumption}`)
        .sort()
        .join("|");
}

function normalizeConditionText(stmt: ArkIfStmt): { conditionText: string; normalizedCondition: string } {
    const conditionText = stmt.getConditionExpr?.()?.toString?.() || stmt.toString();
    const normalizedCondition = conditionText.replace(/\s+/g, "").toLowerCase();
    return { conditionText, normalizedCondition };
}

function isConstantConditionTrue(stmt: ArkIfStmt): boolean | undefined {
    const { normalizedCondition } = normalizeConditionText(stmt);
    if (normalizedCondition === "if(true)" || normalizedCondition === "true") return true;
    if (normalizedCondition === "if(false)" || normalizedCondition === "false") return false;
    return undefined;
}

function getFirstFact(facts: Map<string, SemanticFactType>): SemanticFactType | undefined {
    for (const fact of facts.values()) return fact;
    return undefined;
}

function buildPathConditionId(method: ArkMethod, stmt: ArkIfStmt, normalizedCondition: string, assumption: SemanticPathAssumption): string {
    return `${resolveMethodSignatureText(method)}|${resolveStmtText(stmt)}|${normalizedCondition}|${assumption}`;
}

function appendPathCondition(
    pathConditions: SemanticPathCondition[],
    method: ArkMethod,
    stmt: ArkIfStmt,
    branchIndex: number,
    assumption: SemanticPathAssumption,
    certainty: SemanticPathCondition["certainty"],
): { pathConditions: SemanticPathCondition[]; contradiction: boolean } {
    const { conditionText, normalizedCondition } = normalizeConditionText(stmt);
    const existing = pathConditions.find(item => item.normalizedCondition === normalizedCondition);
    if (existing) {
        if (existing.assumption !== "unknown" && assumption !== "unknown" && existing.assumption !== assumption) {
            return { pathConditions, contradiction: true };
        }
        return { pathConditions, contradiction: false };
    }
    return {
        pathConditions: [
            ...pathConditions,
            {
                id: buildPathConditionId(method, stmt, normalizedCondition, assumption),
                methodSignature: resolveMethodSignatureText(method),
                stmtText: resolveStmtText(stmt),
                conditionText,
                normalizedCondition,
                branchIndex,
                assumption,
                certainty,
            },
        ],
        contradiction: false,
    };
}

function assumptionForBranch(index: number, successorCount: number, condition: boolean | undefined): SemanticPathAssumption {
    if (condition !== undefined) {
        return condition ? "true" : "false";
    }
    if (successorCount === 1) {
        return "true";
    }
    if (index === 0) return "true";
    if (index === 1) return "false";
    return "unknown";
}

function getAssignedLocalName(stmt: ArkAssignStmt): string | undefined {
    const left = stmt.getLeftOp?.() as any;
    const name = left?.getName?.();
    return name === undefined ? undefined : String(name).replace(/\s+/g, "").toLowerCase();
}

function invalidatePathConditionsForAssignment(pathConditions: SemanticPathCondition[], stmt: ArkAssignStmt): SemanticPathCondition[] {
    const assignedName = getAssignedLocalName(stmt);
    if (!assignedName) {
        return pathConditions;
    }
    return pathConditions.filter(item => {
        const names = item.normalizedCondition.split(/[^a-z0-9_$]+/i).filter(Boolean);
        return !names.includes(assignedName);
    });
}

export class SemanticStateWorklistSolver {
    private transitions: SemanticTransition[];

    constructor(transitions?: SemanticTransition[]) {
        this.transitions = transitions && transitions.length > 0
            ? transitions
            : [
                ...createNativeTransitions(),
                ...createStorageTransitions(),
                ...createEventTransitions(),
                ...createAsyncTransitions(),
                ...createStateSlotTransitions(),
                ...createRouterTransitions(),
            ];
    }

    public solve(input: SemanticSolveInput): SemanticSolveResult {
        const sinkSignatures = new Set<string>(input.sinkSignatures || []);
        const sinkRuleIds = new Set<string>(input.sinkRuleIds || []);
        const result: SemanticSolveResultMutable = {
            enabled: true,
            seedCount: input.seeds.length,
            sinkHitCount: 0,
            candidateSeedCount: 0,
            provenanceCount: 0,
            gapCount: 0,
            pathConditionCount: 0,
            sinkHits: [],
            candidateSeeds: [],
            provenance: [],
            gaps: [],
            pathConditions: [],
        };

        const methods = input.scene.getMethods().filter(method => method.getCfg?.());
        const seedByMethod = new Map<string, SemanticFactType[]>();
        for (const seed of input.seeds) {
            const methodSig = seed.methodSignature || "";
            if (!seedByMethod.has(methodSig)) {
                seedByMethod.set(methodSig, []);
            }
            seedByMethod.get(methodSig)!.push(cloneSemanticFact({
                ...seed,
                carrier: buildCarrierFromSeed(seed),
            }));
        }

        const worklist: WorkItem[] = [];
        for (const method of methods) {
            const methodSig = resolveMethodSignatureText(method);
            const methodSeeds = seedByMethod.get(methodSig) || [];
            if (methodSeeds.length === 0) continue;
            const startBlock = method.getCfg?.()?.getStartingBlock?.();
            if (!startBlock) continue;
            const factMap = new Map<string, SemanticFactType>();
            for (const seed of methodSeeds) {
                factMap.set(seed.carrier.key, seed);
                if (seed.tainted) {
                    result.candidateSeeds.push({
                        factId: seed.id,
                        carrierKey: seed.carrier.key,
                        source: seed.source,
                        reason: seed.reason || "seed",
                        methodSignature: seed.methodSignature,
                        stmtText: seed.stmtText,
                    });
                }
            }
            worklist.push({
                method,
                block: startBlock,
                stmtIndex: 0,
                facts: factMap,
                pathConditions: [],
            });
        }

        const visited = new Set<string>();
        const seenSinkHits = new Set<string>();
        const seenCandidateSeeds = new Set<string>(result.candidateSeeds.map(item => `${item.factId}|${item.carrierKey}|${item.reason}`));
        const seenProvenance = new Set<string>();
        const seenGaps = new Set<string>();
        const seenPathConditions = new Set<string>();
        const startedAt = Date.now();
        let dequeues = 0;
        const budget = input.budget || {};

        while (worklist.length > 0) {
            const item = worklist.shift()!;
            dequeues++;
            const visitedKey = `${item.method.getSignature().toString()}|${item.block.toString()}|${item.stmtIndex}|${makeFactsKey(item.facts)}|${makePathConditionsKey(item.pathConditions)}`;
            if (visited.has(visitedKey)) {
                continue;
            }
            visited.add(visitedKey);
            if (budget.maxDequeues !== undefined && dequeues > budget.maxDequeues) {
                result.truncated = {
                    reason: "max_dequeues",
                    dequeues,
                    visited: visited.size,
                    elapsedMs: Date.now() - startedAt,
                };
                break;
            }
            if (budget.maxVisited !== undefined && visited.size > budget.maxVisited) {
                result.truncated = {
                    reason: "max_visited",
                    dequeues,
                    visited: visited.size,
                    elapsedMs: Date.now() - startedAt,
                };
                break;
            }
            if (budget.maxElapsedMs !== undefined && Date.now() - startedAt > budget.maxElapsedMs) {
                result.truncated = {
                    reason: "max_elapsed",
                    dequeues,
                    visited: visited.size,
                    elapsedMs: Date.now() - startedAt,
                };
                break;
            }

            const stmts = item.block.getStmts();
            let facts = cloneFactsMap(item.facts);
            for (let i = item.stmtIndex; i < stmts.length; i++) {
                const stmt = stmts[i];
                const ctx: SemanticTransitionContext = {
                    scene: input.scene,
                    pag: input.pag,
                    method: item.method,
                    stmt,
                    stmtIndex: i,
                    blockId: String(item.block.getId?.() ?? item.block.toString?.() ?? "block"),
                    pathKey: `${item.method.getSignature().toString()}|${item.block.toString()}|${i}`,
                    sinkSignatures,
                    sinkRuleIds,
                };

                for (const fact of [...facts.values()]) {
                    for (const transition of this.transitions) {
                        if (!transition.match(fact, ctx)) continue;
                        const projections = transition.project(fact, ctx);
                        for (const projection of projections) {
                            if (!transition.check(fact, ctx, projection)) {
                                continue;
                            }
                            const updated = transition.update(fact, ctx, projection) || fact;
                            const derivedFacts = transition.derive(updated, ctx, projection);
                            if (derivedFacts.length === 0) {
                                continue;
                            }
                            for (const derived of derivedFacts) {
                                derived.contextId = fact.contextId;
                                derived.order = fact.order + 1;
                                derived.parentFactId = fact.id;
                                derived.transitionId = transition.id;
                                derived.reason = projection.reason;
                                derived.methodSignature = derived.methodSignature || resolveMethodSignatureText(item.method);
                                derived.stmtText = derived.stmtText || resolveStmtText(stmt);
                                derived.id = `${derived.carrier.key}|${derived.source}|${derived.contextId}|${derived.tainted ? "T" : "F"}|${derived.state}|${derived.order}`;
                                facts.set(derived.carrier.key, derived);
                            }
                            const provenanceKey = `${fact.id}|${transition.id}|${projection.reason}|${resolveStmtText(stmt)}`;
                            if (!seenProvenance.has(provenanceKey)) {
                                seenProvenance.add(provenanceKey);
                                transition.record(fact, ctx, projection, derivedFacts, result);
                            }
                            if (projection.gap) {
                                const gapKey = `${fact.id}|${transition.id}|${projection.reason}|${projection.gap.blockedBy}`;
                                if (!seenGaps.has(gapKey)) {
                                    seenGaps.add(gapKey);
                                    result.gaps.push({
                                        factId: fact.id,
                                        carrierKey: fact.carrier.key,
                                        transitionId: transition.id,
                                        reason: projection.reason,
                                        blockedBy: projection.gap.blockedBy,
                                        methodSignature: resolveMethodSignatureText(item.method),
                                        stmtText: resolveStmtText(stmt),
                                    });
                                }
                            }
                            for (const derived of derivedFacts) {
                                if (projection.sinkHit && derived.tainted) {
                                    const sinkKey = `${derived.id}|${projection.sinkHit.sinkSignature}|${projection.sinkHit.sinkRuleId || ""}|${projection.sinkHit.argIndex ?? ""}`;
                                    if (!seenSinkHits.has(sinkKey)) {
                                        seenSinkHits.add(sinkKey);
                                        result.sinkHits.push({
                                            factId: derived.id,
                                            carrierKey: derived.carrier.key,
                                            source: derived.source,
                                            sinkSignature: projection.sinkHit.sinkSignature,
                                            sinkRuleId: projection.sinkHit.sinkRuleId,
                                            methodSignature: resolveMethodSignatureText(item.method),
                                            stmtText: resolveStmtText(stmt),
                                            argIndex: projection.sinkHit.argIndex,
                                        });
                                    }
                                    const candidateKey = `${derived.id}|${derived.carrier.key}|sink:${projection.sinkHit.sinkSignature}`;
                                    if (!seenCandidateSeeds.has(candidateKey)) {
                                        seenCandidateSeeds.add(candidateKey);
                                        result.candidateSeeds.push({
                                            factId: derived.id,
                                            carrierKey: derived.carrier.key,
                                            source: derived.source,
                                            reason: `sink:${projection.sinkHit.sinkSignature}`,
                                            methodSignature: resolveMethodSignatureText(item.method),
                                            stmtText: resolveStmtText(stmt),
                                        });
                                    }
                                }
                            }
                        }
                    }
                }

                if (stmt instanceof ArkAssignStmt) {
                    item.pathConditions = invalidatePathConditionsForAssignment(item.pathConditions, stmt);
                }

                if (stmt instanceof ArkIfStmt) {
                    const condition = isConstantConditionTrue(stmt);
                    const successors = item.block.getSuccessors();
                    if (successors.length === 0) {
                        break;
                    }
                    const nextBlocks = condition === undefined
                        ? successors
                        : [successors[condition ? 0 : 1] || successors[0]];
                    for (let branchIndex = 0; branchIndex < nextBlocks.length; branchIndex++) {
                        const nextBlock = nextBlocks[branchIndex];
                        if (!nextBlock) continue;
                        const assumption = assumptionForBranch(branchIndex, successors.length, condition);
                        const pathUpdate = appendPathCondition(
                            item.pathConditions,
                            item.method,
                            stmt,
                            branchIndex,
                            assumption,
                            condition === undefined ? "assumed" : "constant",
                        );
                        if (pathUpdate.contradiction) {
                            const firstFact = getFirstFact(facts);
                            const gapKey = `${item.method.getSignature().toString()}|${resolveStmtText(stmt)}|path-contradiction|${assumption}`;
                            if (!seenGaps.has(gapKey)) {
                                seenGaps.add(gapKey);
                                result.gaps.push({
                                    factId: firstFact?.id || `${item.method.getSignature().toString()}|branch`,
                                    carrierKey: firstFact?.carrier.key || `${item.method.getSignature().toString()}|branch`,
                                    transitionId: "native.branch",
                                    reason: "path-infeasible",
                                    blockedBy: "contradictory-path-condition",
                                    methodSignature: resolveMethodSignatureText(item.method),
                                    stmtText: resolveStmtText(stmt),
                                });
                            }
                            continue;
                        }
                        for (const pathCondition of pathUpdate.pathConditions) {
                            if (seenPathConditions.has(pathCondition.id)) continue;
                            seenPathConditions.add(pathCondition.id);
                            result.pathConditions.push({ ...pathCondition });
                        }
                        worklist.push({
                            method: item.method,
                            block: nextBlock,
                            stmtIndex: 0,
                            facts: cloneFactsMap(facts),
                            pathConditions: pathUpdate.pathConditions.map(pathCondition => ({ ...pathCondition })),
                        });
                    }
                    if (condition === undefined) {
                        const gapKey = `${item.method.getSignature().toString()}|${resolveStmtText(stmt)}|branch`;
                        if (!seenGaps.has(gapKey)) {
                            seenGaps.add(gapKey);
                            const firstFact = getFirstFact(facts);
                            result.gaps.push({
                                factId: firstFact?.id || `${item.method.getSignature().toString()}|branch`,
                                carrierKey: firstFact?.carrier.key || `${item.method.getSignature().toString()}|branch`,
                                transitionId: "native.branch",
                                reason: "branch-unknown",
                                blockedBy: "unresolved-branch-condition",
                                methodSignature: resolveMethodSignatureText(item.method),
                                stmtText: resolveStmtText(stmt),
                            });
                        }
                    }
                    break;
                }

                if (stmt instanceof ArkReturnStmt || stmt instanceof ArkReturnVoidStmt || stmt instanceof ArkThrowStmt) {
                    break;
                }

                if (i === stmts.length - 1) {
                    const successors = item.block.getSuccessors();
                    if (successors.length === 0) {
                        break;
                    }
                    for (const nextBlock of successors) {
                        worklist.push({
                            method: item.method,
                            block: nextBlock,
                            stmtIndex: 0,
                            facts: cloneFactsMap(facts),
                            pathConditions: item.pathConditions.map(pathCondition => ({ ...pathCondition })),
                        });
                    }
                }
            }
        }

        result.sinkHitCount = result.sinkHits.length;
        result.candidateSeedCount = result.candidateSeeds.length;
        result.provenanceCount = result.provenance.length;
        result.gapCount = result.gaps.length;
        result.pathConditionCount = result.pathConditions.length;
        return result;
    }
}
