import * as fs from "fs";
import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { buildArkMainPlan } from "../../core/entry/arkmain/ArkMainPlanner";
import { buildArkMainExplainabilityBundle } from "../../core/entry/arkmain/explainability/ArkMainReasonReporter";
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

function ensureDir(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
}

function findExplanation(
    report: ReturnType<typeof buildArkMainExplainabilityBundle>["activations"],
    methodName: string,
    className?: string,
    phase?: string,
    edgeFamily?: string,
) {
    return report.find(item =>
        item.methodName === methodName
        && (className === undefined || item.declaringClass === className)
        && (phase === undefined || item.phase === phase)
        && (edgeFamily === undefined || item.activationEdgeFamilies.includes(edgeFamily)),
    );
}

async function main(): Promise<void> {
    const projectDir = path.resolve("tests/demo/arkmain_entry_phases");
    const outputDir = path.resolve("tmp/test_runs/entry_model/ark_main_explainability/latest");
    const outputPath = path.join(outputDir, "arkmain_explainability_report.json");
    ensureDir(outputDir);

    const scene = buildScene(projectDir);
    const plan = buildArkMainPlan(scene);
    const report = buildArkMainExplainabilityBundle(plan.schedule);
    fs.writeFileSync(outputPath, JSON.stringify({
        projectDir,
        ...report,
    }, null, 2), "utf8");

    if (report.schemaVersion !== "arkmain.explainability.v3") {
        throw new Error(`ArkMain explainability schema mismatch: ${report.schemaVersion}`);
    }
    if (report.summary.activationCount !== report.activations.length) {
        throw new Error("ArkMain explainability summary activationCount mismatch.");
    }
    if (!report.summary.scheduling.converged || report.summary.scheduling.truncated) {
        throw new Error(`ArkMain explainability scheduling summary mismatch: converged=${report.summary.scheduling.converged}, truncated=${report.summary.scheduling.truncated}`);
    }
    if (report.summary.scheduling.warnings.length !== 0) {
        throw new Error(`ArkMain explainability scheduling warnings should be empty, got ${report.summary.scheduling.warnings.join(" | ")}`);
    }
    if ((report.summary.activationEdgeKindCounts.baseline_root || 0) === 0) {
        throw new Error("ArkMain explainability summary missing baseline_root count.");
    }
    if ((report.summary.activationEdgeFamilyCounts.baseline_root || 0) === 0) {
        throw new Error("ArkMain explainability summary missing baseline_root family count.");
    }

    const onNewWant = findExplanation(report.activations, "onNewWant", "EntryAbility", "reactive_handoff", "baseline_root");
    if (!onNewWant) {
        throw new Error("ArkMain explainability report missing onNewWant.");
    }
    if (!onNewWant.activationEdgeKinds.includes("baseline_root")) {
        throw new Error(`ArkMain explainability activation mismatch for onNewWant: ${onNewWant.activationEdgeKinds.join(", ")}`);
    }
    if (!onNewWant.reasons.some(reason =>
        reason.evidenceFactKind === "ability_lifecycle"
        && reason.entryFamily === "ability_lifecycle"
        && reason.recognitionLayer === "owner_qualified_inheritance",
    )) {
        throw new Error("ArkMain explainability missing handoff lifecycle metadata for onNewWant.");
    }

    const pageHideProgression = findExplanation(report.activations, "onPageHide", "DemoPage", "teardown", "teardown_lifecycle");
    if (!pageHideProgression) {
        throw new Error("ArkMain explainability report missing lifecycle progression activation for onPageHide.");
    }
    if (!pageHideProgression.activationEdgeKinds.includes("lifecycle_progression")) {
        throw new Error(`ArkMain explainability missing lifecycle_progression for onPageHide: ${pageHideProgression.activationEdgeKinds.join(", ")}`);
    }
    if (!pageHideProgression.supportingEdges.some(edge => edge.kind === "lifecycle_progression" && edge.fromName === "build")) {
        throw new Error("ArkMain explainability missing build -> onPageHide lifecycle progression edge.");
    }

    console.log("PASS test_entry_model_ark_main_explainability");
    console.log(`report=${outputPath}`);
}

main().catch(error => {
    console.error("FAIL test_entry_model_ark_main_explainability");
    console.error(error);
    process.exit(1);
});
