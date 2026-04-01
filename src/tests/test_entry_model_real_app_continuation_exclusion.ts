import * as fs from "fs";
import * as path from "path";
import { Scene } from "../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../arkanalyzer/out/src/Config";
import { buildArkMainPlan } from "../core/entry/arkmain/ArkMainPlanner";
import { registerMockSdkFiles } from "./helpers/TestSceneBuilder";

interface ContinuationExclusionReport {
    generatedAt: string;
    projectRoot: string;
    callbackFactCount: number;
    unknownStructuralCallbackCount: number;
    promiseContinuationFacts: Array<{
        kind: string;
        reason: string;
        methodSignature: string;
        sourceMethodSignature: string;
    }>;
}

const REAL_APP_ROOT = process.env.ARKMAIN_REAL_APP_ROOT || "D:/cursor/workplace/project";
const PROJECT_NAME = process.env.ARKMAIN_REAL_APP_PROJECT || "HarmonyStudy";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function ensureDir(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
}

function buildScene(projectDir: string): Scene {
    const config = new SceneConfig();
    config.buildFromProjectDir(projectDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    registerMockSdkFiles(scene);
    return scene;
}

function signatureOf(method: any): string {
    return method?.getSignature?.()?.toString?.() || "<unknown>";
}

function isPromiseContinuationReason(reason: string | undefined): boolean {
    const text = String(reason || "");
    return text.includes("@channel.then")
        || text.includes("@channel.catch")
        || text.includes("@channel.finally")
        || text.includes("Promise.then")
        || text.includes("Promise.catch")
        || text.includes("Promise.finally");
}

async function main(): Promise<void> {
    const projectRoot = path.resolve(REAL_APP_ROOT, PROJECT_NAME);
    assert(fs.existsSync(projectRoot), `real app project not found: ${projectRoot}`);

    const scene = buildScene(projectRoot);
    const plan = buildArkMainPlan(scene);
    const callbackFacts = plan.facts.filter(fact => fact.kind === "callback" || fact.kind === "scheduler_callback");
    const promiseContinuationFacts = callbackFacts
        .filter(fact => isPromiseContinuationReason(fact.reason))
        .map(fact => ({
            kind: fact.kind,
            reason: fact.reason,
            methodSignature: signatureOf(fact.method),
            sourceMethodSignature: signatureOf(fact.sourceMethod),
        }));

    const report: ContinuationExclusionReport = {
        generatedAt: new Date().toISOString(),
        projectRoot,
        callbackFactCount: callbackFacts.length,
        unknownStructuralCallbackCount: plan.facts.filter(fact => fact.entryFamily === "unknown_structural_callback").length,
        promiseContinuationFacts,
    };

    const outputDir = path.resolve("tmp/test_runs/entry_model/real_app_continuation_exclusion/latest");
    const outputPath = path.join(outputDir, "harmonystudy_continuation_exclusion_report.json");
    ensureDir(outputDir);
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf8");

    assert(
        report.promiseContinuationFacts.length === 0,
        `Promise continuation must not appear as ArkMain entry fact in ${PROJECT_NAME}; found ${report.promiseContinuationFacts.length}`,
    );

    console.log("PASS test_entry_model_real_app_continuation_exclusion");
    console.log(`report=${outputPath}`);
    console.log(`callback_fact_count=${report.callbackFactCount}`);
    console.log(`unknown_structural_callback_count=${report.unknownStructuralCallbackCount}`);
}

main().catch(error => {
    console.error("FAIL test_entry_model_real_app_continuation_exclusion");
    console.error(error);
    process.exit(1);
});

