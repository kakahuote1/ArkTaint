import * as fs from "fs";
import * as path from "path";
import { Scene } from "../../../arkanalyzer/lib/Scene";
import { SceneConfig } from "../../../arkanalyzer/lib/Config";
import { ArkMethod } from "../../../arkanalyzer/lib/core/model/ArkMethod";
import { buildArkMainPlan } from "../../core/entry/arkmain/ArkMainPlanner";
import { findCaseMethod, resolveCaseMethod } from "../helpers/SyntheticCaseHarness";
import { registerMockSdkFiles } from "../helpers/TestSceneBuilder";

function hasSdkLikeImports(projectDir: string): boolean {
    for (const entry of fs.readdirSync(projectDir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        if (!/\.(ets|ts)$/.test(entry.name)) continue;
        const text = fs.readFileSync(path.join(projectDir, entry.name), "utf8");
        if (/@ohos|@kit/.test(text)) {
            return true;
        }
    }
    return false;
}

function buildScene(projectDir: string): Scene {
    const config = new SceneConfig();
    const harmonySdkDir = path.resolve("arkanalyzer/tests/resources/Sdk");
    if (fs.existsSync(harmonySdkDir) && hasSdkLikeImports(projectDir)) {
        config.getSdksObj().push({
            moduleName: "",
            name: "harmony-sdk",
            path: harmonySdkDir,
        });
    }
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

function findMethod(scene: Scene, className: string, methodName: string): ArkMethod {
    const method = scene.getMethods().find(item =>
        (item.getDeclaringArkClass?.()?.getName?.() || "@global") === className
        && item.getName?.() === methodName,
    );
    assert(method, `missing method ${className}.${methodName}`);
    return method!;
}

function assertSlotFamiliesAreFormalized(plan: ReturnType<typeof buildArkMainPlan>): void {
    for (const fact of plan.facts) {
        if (fact.kind !== "callback") continue;
        if (!fact.callbackSlotFamily) continue;
        if (fact.entryFamily !== fact.callbackSlotFamily) {
            throw new Error(
                `callback family catalog mismatch for ${fact.method.getSignature?.()?.toString?.() || fact.method.getName?.()}: `
                + `slotFamily=${fact.callbackSlotFamily}, entryFamily=${fact.entryFamily}`,
            );
        }
    }
}

function assertHasCallbackFamily(
    plan: ReturnType<typeof buildArkMainPlan>,
    sourceMethod: ArkMethod,
    family: string,
): void {
    const sourceSignature = sourceMethod.getSignature?.()?.toString?.();
    const matched = plan.facts.some(fact =>
        fact.kind === "callback"
        && fact.sourceMethod?.getSignature?.()?.toString?.() === sourceSignature
        && fact.callbackSlotFamily === family
        && fact.entryFamily === family,
    );
    assert(matched, `missing callback family ${family} for source ${sourceMethod.getSignature?.()?.toString?.()}`);
}

async function main(): Promise<void> {
    const dslProjectDir = path.resolve("tests/demo/sdk_callback_provenance_probe");
    const dslScene = buildScene(dslProjectDir);
    const dslBuild = findMethod(dslScene, "SdkCallbackProbeDsl", "build");
    const dslPlan = buildArkMainPlan(dslScene);
    assertSlotFamiliesAreFormalized(dslPlan);
    assertHasCallbackFamily(dslPlan, dslBuild, "ui_direct_slot");
    assertHasCallbackFamily(dslPlan, dslBuild, "gesture_direct_slot");

    const workerProjectDir = path.resolve("tests/demo/harmony_worker");
    const workerScene = buildScene(workerProjectDir);
    const workerEntry = resolveCaseMethod(workerScene, "worker_postmessage_001_T.ets", "worker_postmessage_001_T");
    const workerMethod = findCaseMethod(workerScene, workerEntry);
    assert(workerMethod, "failed to resolve worker_postmessage_001_T entry method");
    const workerPlan = buildArkMainPlan(workerScene, { seedMethods: [workerMethod!] });
    assertSlotFamiliesAreFormalized(workerPlan);
    assertHasCallbackFamily(workerPlan, workerMethod!, "system_direct_slot");

    const realworldProjectDir = path.resolve("tests/demo/pure_entry_realworld");
    const realworldScene = buildScene(realworldProjectDir);
    const aboutToAppear = findMethod(realworldScene, "ResponsiveDashboard", "aboutToAppear");
    const realworldPlan = buildArkMainPlan(realworldScene, { seedMethods: [aboutToAppear] });
    assertSlotFamiliesAreFormalized(realworldPlan);
    assertHasCallbackFamily(realworldPlan, aboutToAppear, "subscription_event_slot");
    assertHasCallbackFamily(realworldPlan, aboutToAppear, "completion_callback_slot");

    console.log("PASS test_entry_model_callback_family_catalog");
}

main().catch(error => {
    console.error("FAIL test_entry_model_callback_family_catalog");
    console.error(error);
    process.exit(1);
});
