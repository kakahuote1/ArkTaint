import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { ArkMethod } from "../../../../arkanalyzer/out/src/core/model/ArkMethod";
import { ArkMainActivationGraph, buildArkMainActivationGraph } from "./edges/ArkMainActivationGraph";
import {
    collectArkMainEntryFacts,
    expandSeedMethodsByDirectCalls,
} from "./facts/ArkMainFactResolvers";
import { buildArkMainContracts, buildArkMainSourceRulesFromContracts } from "./facts/ArkMainContractBuilder";
import { ArkMainSchedule, buildArkMainSchedule } from "./scheduling/ArkMainScheduler";
import {
    ARK_MAIN_PHASE_ORDER,
    ArkMainContract,
    ArkMainEntryFact,
    ArkMainPhaseName,
    ArkMainPhasePlan,
    ArkMainPlanOptions,
    ArkMainSourceRule,
} from "./ArkMainTypes";

export type {
    ArkMainEntryFact,
    ArkMainPhaseName,
    ArkMainPhasePlan,
    ArkMainPlanOptions,
} from "./ArkMainTypes";
export { ARK_MAIN_PHASE_ORDER } from "./ArkMainTypes";
export {
    collectArkMainEntryFacts,
    expandSeedMethodsByDirectCalls,
} from "./facts/ArkMainFactResolvers";

export interface ArkMainPlan {
    contracts: ArkMainContract[];
    sourceRules: ArkMainSourceRule[];
    facts: ArkMainEntryFact[];
    activationGraph: ArkMainActivationGraph;
    schedule: ArkMainSchedule;
    phases: ArkMainPhasePlan[];
    orderedMethods: ArkMethod[];
}

export function buildArkMainPlan(scene: Scene, options: ArkMainPlanOptions = {}): ArkMainPlan {
    const _t0 = Date.now();
    const expandedSeedMethods = expandSeedMethodsByDirectCalls(scene, options.seedMethods || []);
    const _t1 = Date.now();
    const facts = collectArkMainEntryFacts(scene, expandedSeedMethods);
    const _t2 = Date.now();
    const activationGraph = buildArkMainActivationGraph(facts, expandedSeedMethods);
    const _t3 = Date.now();
    const schedule = buildArkMainSchedule(activationGraph);
    const _t4 = Date.now();
    const contracts = buildArkMainContracts(scene, facts, activationGraph, schedule);
    const _t5 = Date.now();
    const sourceRules = buildArkMainSourceRulesFromContracts(contracts);
    const _t6 = Date.now();
    const phases = buildPhasePlansFromSchedule(facts, schedule);
    const _t7 = Date.now();
    if (_t7 - _t0 > 500) {
        console.log(`[ArkMain profiling] expandSeed=${_t1 - _t0}ms facts=${_t2 - _t1}ms graph=${_t3 - _t2}ms schedule=${_t4 - _t3}ms contracts=${_t5 - _t4}ms sources=${_t6 - _t5}ms phases=${_t7 - _t6}ms total=${_t7 - _t0}ms`);
    }

    return {
        contracts,
        sourceRules,
        facts,
        activationGraph,
        schedule,
        phases,
        orderedMethods: dedupeMethods(schedule.orderedMethods),
    };
}

function buildPhasePlansFromSchedule(
    facts: ArkMainEntryFact[],
    schedule: ArkMainSchedule,
): ArkMainPhasePlan[] {
    return ARK_MAIN_PHASE_ORDER.map(phase => {
        const phaseFacts = facts.filter(f => f.phase === phase);
        const phaseMethods = schedule.activations
            .filter(item => item.phase === phase)
            .map(item => item.method);
        return {
            phase,
            facts: phaseFacts,
            methods: dedupeMethods(phaseMethods),
        };
    });
}

function dedupeMethods(methods: ArkMethod[]): ArkMethod[] {
    const out = new Map<string, ArkMethod>();
    for (const method of methods) {
        const signature = method?.getSignature?.()?.toString?.();
        if (!signature || out.has(signature)) continue;
        out.set(signature, method);
    }
    return [...out.values()];
}
