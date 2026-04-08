import * as fs from "fs";
import * as path from "path";
import { Scene } from "../../../arkanalyzer/lib/Scene";
import { SceneConfig } from "../../../arkanalyzer/lib/Config";
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

function findExplanation(report: ReturnType<typeof buildArkMainExplainabilityBundle>["activations"], methodName: string, className?: string) {
    return report.find(item =>
        item.methodName === methodName
        && (className === undefined || item.declaringClass === className),
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

    if (report.schemaVersion !== "arkmain.explainability.v2") {
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
    if ((report.summary.phaseCounts.interaction || 0) === 0) {
        throw new Error("ArkMain explainability summary missing interaction phase count.");
    }
    if ((report.summary.activationEdgeKindCounts.callback_registration || 0) === 0) {
        throw new Error("ArkMain explainability summary missing callback_registration count.");
    }
    if ((report.summary.activationEdgeFamilyCounts.ui_callback || 0) === 0) {
        throw new Error("ArkMain explainability summary missing ui_callback family count.");
    }

    const click = findExplanation(report.activations, "cbOnClick", "%dflt");
    if (!click) {
        throw new Error("ArkMain explainability report missing cbOnClick.");
    }
    if (click.phase !== "interaction" || click.round !== 1) {
        throw new Error(`ArkMain explainability phase/round mismatch for cbOnClick: ${click.phase}/${click.round}`);
    }
    if (!click.activationEdgeKinds.includes("callback_registration")) {
        throw new Error(`ArkMain explainability missing callback_registration for cbOnClick: ${click.activationEdgeKinds.join(", ")}`);
    }
    if (!click.activationEdgeFamilies.includes("ui_callback")) {
        throw new Error(`ArkMain explainability missing ui_callback family for cbOnClick: ${click.activationEdgeFamilies.join(", ")}`);
    }
    if (!click.supportingEdges.some(edge => edge.fromName === "build" && edge.kind === "callback_registration")) {
        throw new Error("ArkMain explainability missing build -> cbOnClick supporting edge.");
    }
    if (!click.reasons.some(reason => reason.evidenceMethodName === "build" && reason.evidenceFactKind === "callback")) {
        throw new Error("ArkMain explainability missing callback fact evidence for cbOnClick.");
    }
    if (!click.reasons.some(reason =>
        reason.evidenceFactKind === "callback"
        && reason.entryFamily === "ui_direct_slot"
        && reason.recognitionLayer === "sdk_provenance"
        && reason.callbackShape === "direct_callback_slot"
        && reason.callbackSlotFamily === "ui_direct_slot",
    )) {
        throw new Error("ArkMain explainability missing callback recognition metadata for cbOnClick.");
    }

    const watch = findExplanation(report.activations, "onTokenWatch", "DemoPage");
    if (!watch) {
        throw new Error("ArkMain explainability report missing onTokenWatch.");
    }
    if (!watch.activationEdgeKinds.includes("state_watch_trigger")) {
        throw new Error(`ArkMain explainability missing state_watch_trigger for onTokenWatch: ${watch.activationEdgeKinds.join(", ")}`);
    }
    const watchEvidenceKinds = new Set(watch.reasons.map(reason => reason.evidenceFactKind));
    if (!watchEvidenceKinds.has("watch_source") || !watchEvidenceKinds.has("watch_handler")) {
        throw new Error(`ArkMain explainability missing watch-source/watch-handler evidence for onTokenWatch: ${[...watchEvidenceKinds].join(", ")}`);
    }

    const onNewWant = findExplanation(report.activations, "onNewWant", "EntryAbility");
    if (!onNewWant) {
        throw new Error("ArkMain explainability report missing onNewWant.");
    }
    if (!onNewWant.activationEdgeKinds.includes("baseline_root") || !onNewWant.activationEdgeKinds.includes("want_handoff")) {
        throw new Error(`ArkMain explainability missing dual activation kinds for onNewWant: ${onNewWant.activationEdgeKinds.join(", ")}`);
    }
    if (!onNewWant.activationEdgeFamilies.includes("baseline_root") || !onNewWant.activationEdgeFamilies.includes("ability_handoff")) {
        throw new Error(`ArkMain explainability missing dual activation families for onNewWant: ${onNewWant.activationEdgeFamilies.join(", ")}`);
    }
    if (!onNewWant.supportingEdges.some(edge => edge.kind === "want_handoff" && edge.fromName === "onCreate")) {
        throw new Error("ArkMain explainability missing onCreate -> onNewWant handoff edge.");
    }
    if (!onNewWant.supportingEdges.some(edge => edge.kind === "want_handoff" && edge.edgeFamily === "ability_handoff" && edge.fromName === "onCreate")) {
        throw new Error("ArkMain explainability missing handoff edge family metadata for onNewWant.");
    }
    if (!onNewWant.reasons.some(reason =>
        reason.evidenceFactKind === "want_handoff"
        && reason.entryFamily === "ability_handoff"
        && reason.recognitionLayer === "owner_qualified_inheritance",
    )) {
        throw new Error("ArkMain explainability missing handoff family metadata for onNewWant.");
    }

    console.log("PASS test_entry_model_ark_main_explainability");
    console.log(`report=${outputPath}`);
}

main().catch(error => {
    console.error("FAIL test_entry_model_ark_main_explainability");
    console.error(error);
    process.exit(1);
});


