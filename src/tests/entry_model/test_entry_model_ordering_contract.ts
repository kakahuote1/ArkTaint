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
    assertOrderingContract("baseline_root", {
        targetPhase: "bootstrap",
        minRoundGap: 0,
        allowedSourcePhases: "any",
    });
    assertOrderingContract("composition_lifecycle", {
        targetPhase: "composition",
        minRoundGap: 1,
        allowedSourcePhases: ["bootstrap"],
    });
    assertOrderingContract("interaction_lifecycle", {
        targetPhase: "interaction",
        minRoundGap: 1,
        allowedSourcePhases: ["bootstrap", "composition"],
    });
    assertOrderingContract("teardown_lifecycle", {
        targetPhase: "teardown",
        minRoundGap: 1,
        allowedSourcePhases: ["bootstrap", "composition", "interaction"],
    });

    const phasesPlan = buildArkMainPlan(buildScene(path.resolve("tests/demo/arkmain_entry_phases")));
    const rootPhaseHints = new Set(
        phasesPlan.activationGraph.edges
            .filter(edge => edge.edgeFamily === "baseline_root")
            .map(edge => edge.phaseHint),
    );
    assert(rootPhaseHints.has("bootstrap"), "baseline_root should preserve bootstrap entry phases");
    assert(rootPhaseHints.has("composition"), "baseline_root should preserve composition entry phases");
    assert(rootPhaseHints.has("reactive_handoff"), "baseline_root should preserve reactive_handoff entry phases");
    assert(rootPhaseHints.has("teardown"), "baseline_root should preserve teardown entry phases");
    assertPlanEdgePhases(phasesPlan, "teardown_lifecycle");

    const stagePlan = buildArkMainPlan(buildScene(path.resolve("tests/demo/pure_entry_realworld")));
    assertPlanEdgePhases(stagePlan, "interaction_lifecycle");

    console.log("PASS test_entry_model_ordering_contract");
}

main().catch(error => {
    console.error("FAIL test_entry_model_ordering_contract");
    console.error(error);
    process.exit(1);
});
