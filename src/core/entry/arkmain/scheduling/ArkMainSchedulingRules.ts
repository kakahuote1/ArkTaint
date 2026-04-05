import { ArkMainActivationEdge, ArkMainActivationEdgeFamily } from "../edges/ArkMainActivationTypes";
import { ARK_MAIN_PHASE_ORDER, ArkMainPhaseName } from "../ArkMainTypes";

export interface ArkMainSchedulingRule {
    edgeFamily: ArkMainActivationEdgeFamily;
    targetPhase: ArkMainPhaseName;
    minRoundGap: number;
    allowedSourcePhases: "any" | ArkMainPhaseName[];
    allowsRootlessActivation?: boolean;
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
    ui_callback: {
        edgeFamily: "ui_callback",
        targetPhase: "interaction",
        minRoundGap: 1,
        allowedSourcePhases: ["composition"],
    },
    channel_callback: {
        edgeFamily: "channel_callback",
        targetPhase: "interaction",
        minRoundGap: 1,
        allowedSourcePhases: "any",
    },
    scheduler_callback: {
        edgeFamily: "scheduler_callback",
        targetPhase: "interaction",
        minRoundGap: 1,
        allowedSourcePhases: ["bootstrap", "composition", "reactive_handoff"],
    },
    state_watch: {
        edgeFamily: "state_watch",
        targetPhase: "reactive_handoff",
        minRoundGap: 1,
        allowedSourcePhases: ["bootstrap", "composition", "reactive_handoff"],
    },
    navigation_channel: {
        edgeFamily: "navigation_channel",
        targetPhase: "reactive_handoff",
        minRoundGap: 1,
        allowedSourcePhases: ["composition"],
        allowsRootlessActivation: true,
    },
    ability_handoff: {
        edgeFamily: "ability_handoff",
        targetPhase: "reactive_handoff",
        minRoundGap: 1,
        allowedSourcePhases: ["bootstrap"],
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
        return Boolean(rule.allowsRootlessActivation) && round >= rule.minRoundGap;
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


