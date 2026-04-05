import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { buildArkMainPlan } from "../../core/entry/arkmain/ArkMainPlanner";
import { ArkMainActivationEdgeFamily } from "../../core/entry/arkmain/edges/ArkMainActivationTypes";
import {
    getArkMainSchedulingRule,
    getArkMainTargetPhase,
} from "../../core/entry/arkmain/scheduling/ArkMainSchedulingRules";
import { registerMockSdkFiles } from "../helpers/TestSceneBuilder";
import { findCaseMethod, resolveCaseMethod } from "../helpers/SyntheticCaseHarness";

function buildScene(projectDir: string): Scene {
    const config = new SceneConfig();
    config.buildFromProjectDir(projectDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    registerMockSdkFiles(scene);
    return scene;
}

function assert(condition: unknown, message: string): void {
    if (!condition) {
        throw new Error(message);
    }
}

function assertOrderingContract(
    edgeFamily: ArkMainActivationEdgeFamily,
    expected: {
        targetPhase: string;
        minRoundGap: number;
        allowedSourcePhases: "any" | string[];
        allowsRootlessActivation?: boolean;
    },
): void {
    const contract = getArkMainSchedulingRule(edgeFamily);
    assert(contract.targetPhase === expected.targetPhase, `${edgeFamily} targetPhase mismatch`);
    assert(contract.minRoundGap === expected.minRoundGap, `${edgeFamily} minRoundGap mismatch`);
    if (expected.allowedSourcePhases === "any") {
        assert(contract.allowedSourcePhases === "any", `${edgeFamily} allowedSourcePhases mismatch`);
    } else {
        assert(contract.allowedSourcePhases !== "any", `${edgeFamily} allowedSourcePhases should be array`);
        assert(
            JSON.stringify([...contract.allowedSourcePhases].sort()) === JSON.stringify([...expected.allowedSourcePhases].sort()),
            `${edgeFamily} allowedSourcePhases mismatch`,
        );
    }
    assert(Boolean(contract.allowsRootlessActivation) === Boolean(expected.allowsRootlessActivation), `${edgeFamily} rootless flag mismatch`);
    assert(getArkMainTargetPhase(edgeFamily) === expected.targetPhase, `${edgeFamily} target phase helper mismatch`);
}

function assertPlanEdgePhases(
    plan: ReturnType<typeof buildArkMainPlan>,
    edgeFamily: ArkMainActivationEdgeFamily,
): void {
    const expectedPhase = getArkMainTargetPhase(edgeFamily);
    const familyEdges = plan.activationGraph.edges.filter(edge => edge.edgeFamily === edgeFamily);
    assert(familyEdges.length > 0, `Missing edges for ${edgeFamily}`);
    for (const edge of familyEdges) {
        assert(edge.phaseHint === expectedPhase, `${edgeFamily} edge phaseHint drifted from ordering contract`);
    }

    const familyActivations = plan.schedule.activations.filter(item => item.activationEdgeFamilies.includes(edgeFamily));
    assert(familyActivations.length > 0, `Missing activations for ${edgeFamily}`);
    for (const activation of familyActivations) {
        assert(activation.phase === expectedPhase, `${edgeFamily} scheduled activation phase drifted from ordering contract`);
    }
}

async function main(): Promise<void> {
    assertOrderingContract("ui_callback", {
        targetPhase: "interaction",
        minRoundGap: 1,
        allowedSourcePhases: ["composition"],
    });
    assertOrderingContract("channel_callback", {
        targetPhase: "interaction",
        minRoundGap: 1,
        allowedSourcePhases: "any",
    });
    assertOrderingContract("scheduler_callback", {
        targetPhase: "interaction",
        minRoundGap: 1,
        allowedSourcePhases: ["bootstrap", "composition", "reactive_handoff"],
    });
    assertOrderingContract("state_watch", {
        targetPhase: "reactive_handoff",
        minRoundGap: 1,
        allowedSourcePhases: ["bootstrap", "composition", "reactive_handoff"],
    });
    assertOrderingContract("navigation_channel", {
        targetPhase: "reactive_handoff",
        minRoundGap: 1,
        allowedSourcePhases: ["composition"],
        allowsRootlessActivation: true,
    });
    assertOrderingContract("ability_handoff", {
        targetPhase: "reactive_handoff",
        minRoundGap: 1,
        allowedSourcePhases: ["bootstrap"],
    });

    const phasesPlan = buildArkMainPlan(buildScene(path.resolve("tests/demo/arkmain_entry_phases")));
    assertPlanEdgePhases(phasesPlan, "ui_callback");
    assertPlanEdgePhases(phasesPlan, "state_watch");
    assertPlanEdgePhases(phasesPlan, "navigation_channel");
    assertPlanEdgePhases(phasesPlan, "ability_handoff");

    const schedulerPlan = buildArkMainPlan(buildScene(path.resolve("tests/demo/arkmain_scheduler_entry")));
    assertPlanEdgePhases(schedulerPlan, "scheduler_callback");

    const workerScene = buildScene(path.resolve("tests/demo/harmony_worker"));
    const workerEntry = resolveCaseMethod(workerScene, "worker_postmessage_001_T.ets", "worker_postmessage_001_T");
    const workerCaseMethod = findCaseMethod(workerScene, workerEntry);
    assert(!!workerCaseMethod, "Failed to resolve harmony_worker seed case");
    const workerPlan = buildArkMainPlan(workerScene, { seedMethods: workerCaseMethod ? [workerCaseMethod] : [] });
    assertPlanEdgePhases(workerPlan, "channel_callback");

    console.log("PASS test_entry_model_ordering_contract");
}

main().catch(error => {
    console.error("FAIL test_entry_model_ordering_contract");
    console.error(error);
    process.exit(1);
});
