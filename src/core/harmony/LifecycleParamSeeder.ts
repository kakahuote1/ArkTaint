import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { Pag } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt } from "../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkParameterRef } from "../../../arkanalyzer/out/src/core/base/Ref";
import { Local } from "../../../arkanalyzer/out/src/core/base/Local";
import { ArkMethod } from "../../../arkanalyzer/out/src/core/model/ArkMethod";
import { TaintFact } from "../TaintFact";
import { HarmonySeedCollectionResult } from "./HarmonySeedTypes";

type ParamMatchMode = "name_only" | "name_and_type";

export interface LifecycleParamSeedSpec {
    sourceRuleId: string;
    methodNames: string[];
    paramNameIncludes: string[];
    paramTypeIncludes?: string[];
    matchMode: ParamMatchMode;
    targetFieldPaths?: string[][];
    fallbackSeedRootWhenNoPointsTo?: boolean;
    seedRootAlso?: boolean;
}

export interface LifecycleParamSeedArgs {
    scene: Scene;
    pag: Pag;
    emptyContextId: number;
    allowedMethodSignatures?: Set<string>;
    specs: LifecycleParamSeedSpec[];
}

export function collectLifecycleParamSeeds(args: LifecycleParamSeedArgs): HarmonySeedCollectionResult {
    const factById = new Map<string, TaintFact>();
    const seededLocals = new Set<string>();
    const sourceRuleHits = new Map<string, number>();

    for (const method of args.scene.getMethods()) {
        if (method.getName() === "%dflt") continue;
        if (
            args.allowedMethodSignatures
            && !args.allowedMethodSignatures.has(method.getSignature().toString())
        ) {
            continue;
        }
        const parameterLocals = resolveParameterLocals(method);
        if (parameterLocals.size === 0) continue;

        for (const spec of args.specs) {
            if (!spec.methodNames.includes(method.getName())) continue;
            const indexes = resolveMatchedParameterIndexes(method, spec);
            for (const idx of indexes) {
                const local = parameterLocals.get(idx);
                if (!local) continue;
                const facts = seedFactsFromParamLocal(
                    args.pag,
                    local,
                    `source_rule:${spec.sourceRuleId}`,
                    args.emptyContextId,
                    spec.targetFieldPaths || [],
                    spec.fallbackSeedRootWhenNoPointsTo !== false,
                    spec.seedRootAlso === true
                );
                for (const fact of facts) {
                    if (factById.has(fact.id)) continue;
                    factById.set(fact.id, fact);
                    sourceRuleHits.set(spec.sourceRuleId, (sourceRuleHits.get(spec.sourceRuleId) || 0) + 1);
                }
                seededLocals.add(`${method.getName()}:${local.getName()}`);
            }
        }
    }

    return {
        facts: [...factById.values()],
        seededLocals: [...seededLocals].sort(),
        sourceRuleHits: toRecord(sourceRuleHits),
    };
}

function resolveMatchedParameterIndexes(method: ArkMethod, spec: LifecycleParamSeedSpec): number[] {
    const out: number[] = [];
    const parameters = method.getParameters() || [];
    for (let i = 0; i < parameters.length; i++) {
        const parameter = parameters[i];
        const paramName = String(parameter.getName?.() || "").toLowerCase();
        const paramType = String(parameter.getType?.()?.toString?.() || "").toLowerCase();

        const hasName = spec.paramNameIncludes.some(k => paramName.includes(k.toLowerCase()));
        if (!hasName) continue;

        if (spec.matchMode === "name_only") {
            out.push(i);
            continue;
        }

        const typeKeys = spec.paramTypeIncludes || [];
        const hasType = typeKeys.some(k => paramType.includes(k.toLowerCase()));
        if (hasType) {
            out.push(i);
        }
    }
    return out;
}

function resolveParameterLocals(method: ArkMethod): Map<number, Local> {
    const mapping = new Map<number, Local>();
    const cfg = method.getCfg();
    if (!cfg) return mapping;

    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const right = stmt.getRightOp();
        if (!(right instanceof ArkParameterRef)) continue;
        const left = stmt.getLeftOp();
        if (!(left instanceof Local)) continue;
        mapping.set(right.getIndex(), left);
    }
    return mapping;
}

function seedFactsFromParamLocal(
    pag: Pag,
    local: Local,
    sourceTag: string,
    emptyContextId: number,
    targetFieldPaths: string[][],
    fallbackSeedRootWhenNoPointsTo: boolean,
    seedRootAlso: boolean
): TaintFact[] {
    const out: TaintFact[] = [];
    const factIds = new Set<string>();
    const addFact = (fact: TaintFact): void => {
        if (factIds.has(fact.id)) return;
        factIds.add(fact.id);
        out.push(fact);
    };

    const localNodes = pag.getNodesByValue(local);
    if (!localNodes || localNodes.size === 0) return out;

    let hasPointedObject = false;
    for (const localNodeId of localNodes.values()) {
        const localNode: any = pag.getNode(localNodeId);
        const pointsTo: Iterable<number> = localNode?.getPointTo?.() || [];
        for (const objectNodeId of pointsTo) {
            hasPointedObject = true;
            const objectNode = pag.getNode(objectNodeId) as any;
            if (targetFieldPaths.length > 0) {
                for (const pathSegs of targetFieldPaths) {
                    addFact(new TaintFact(objectNode, sourceTag, emptyContextId, [...pathSegs]));
                }
            }
            if (seedRootAlso) {
                addFact(new TaintFact(objectNode, sourceTag, emptyContextId));
            }
        }
    }

    if ((!hasPointedObject && fallbackSeedRootWhenNoPointsTo) || seedRootAlso) {
        for (const localNodeId of localNodes.values()) {
            addFact(new TaintFact(pag.getNode(localNodeId) as any, sourceTag, emptyContextId));
        }
    }

    return out;
}

function toRecord(map: Map<string, number>): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        out[k] = v;
    }
    return out;
}

