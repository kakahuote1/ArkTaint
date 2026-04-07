import { ArkMainActivationEdge, ArkMainActivationEdgeFamily } from "../edges/ArkMainActivationTypes";
import { ARK_MAIN_PHASE_ORDER, ArkMainPhaseName } from "../ArkMainTypes";

export interface ArkMainSchedulingRule {
    edgeFamily: ArkMainActivationEdgeFamily;
    targetPhase: ArkMainPhaseName;
    minRoundGap: number;
    allowedSourcePhases: "any" | ArkMainPhaseName[];
}

interface ArkMainSchedulingActivationLike {
    phase: ArkMainPhaseName;
    round: number;
}

const ARK_MAIN_PHASE_RANK = new Map<ArkMainPhaseName, number>(
    ARK_MAIN_PHASE_ORDER.map((phase, index) => [phase, index] as const),
);

const ARK_MAIN_SCHEDULING_RULES: Record<ArkMainActivationEdgeFamily, ArkMainSchedulingRule> = {
    baseline_root: {
        edgeFamily: "baseline_root",
        targetPhase: "bootstrap",
        minRoundGap: 0,
        allowedSourcePhases: "any",
    },
    composition_lifecycle: {
        edgeFamily: "composition_lifecycle",
        targetPhase: "composition",
        minRoundGap: 1,
        allowedSourcePhases: ["bootstrap"],
    },
    interaction_lifecycle: {
        edgeFamily: "interaction_lifecycle",
        targetPhase: "interaction",
        minRoundGap: 1,
        allowedSourcePhases: ["bootstrap", "composition"],
    },
    teardown_lifecycle: {
        edgeFamily: "teardown_lifecycle",
        targetPhase: "teardown",
        minRoundGap: 1,
        allowedSourcePhases: ["bootstrap", "composition", "interaction"],
    },
};

export function getArkMainSchedulingRule(edgeFamily: ArkMainActivationEdgeFamily): ArkMainSchedulingRule {
    return ARK_MAIN_SCHEDULING_RULES[edgeFamily];
}

export function getArkMainTargetPhase(edgeFamily: ArkMainActivationEdgeFamily): ArkMainPhaseName {
    return getArkMainSchedulingRule(edgeFamily).targetPhase;
}

export function canScheduleArkMainActivationEdge(
    edge: ArkMainActivationEdge,
    sourceActivation: ArkMainSchedulingActivationLike | undefined,
    round: number,
): boolean {
    if (edge.kind === "baseline_root") {
        return round === 0;
    }
    const rule = getArkMainSchedulingRule(edge.edgeFamily);
    if (!sourceActivation) {
        return false;
    }
    if (sourceActivation.round > round - rule.minRoundGap) {
        return false;
    }
    if (rule.allowedSourcePhases !== "any" && !rule.allowedSourcePhases.includes(sourceActivation.phase)) {
        return false;
    }
    return true;
}

export function compareArkMainPhases(left: ArkMainPhaseName, right: ArkMainPhaseName): number {
    return getArkMainPhaseRank(left) - getArkMainPhaseRank(right);
}

export function getArkMainPhaseRank(phase: ArkMainPhaseName): number {
    return ARK_MAIN_PHASE_RANK.get(phase) ?? Number.MAX_SAFE_INTEGER;
}


