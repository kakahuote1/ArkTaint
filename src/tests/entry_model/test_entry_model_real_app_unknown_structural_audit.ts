import * as fs from "fs";
import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { buildArkMainPlan } from "../../core/entry/arkmain/ArkMainPlanner";
import { registerMockSdkFiles } from "../helpers/TestSceneBuilder";

interface AuditReport {
    generatedAt: string;
    projectId: string;
    projectRoot: string;
    totalUnknownStructuralCallbacks: number;
    reasons: string[];
}

interface ProjectAuditConfig {
    outputFileName: string;
}

const REAL_APP_ROOT = process.env.ARKMAIN_REAL_APP_ROOT || "D:/cursor/workplace/project";
const PROJECT_NAME = process.argv[2] || process.env.ARKMAIN_REAL_APP_PROJECT || "WanAndroidHarmoney";

const PROJECT_AUDIT_CONFIGS: Record<string, ProjectAuditConfig> = {
    WanAndroidHarmoney: {
        outputFileName: "wanandroid_unknown_structural_audit_report.json",
    },
    HarmonyStudy: {
        outputFileName: "harmonystudy_unknown_structural_audit_report.json",
    },
};

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

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

async function main(): Promise<void> {
    const projectConfig = PROJECT_AUDIT_CONFIGS[PROJECT_NAME];
    assert(projectConfig, `missing project audit config for ${PROJECT_NAME}`);
    const projectRoot = path.resolve(REAL_APP_ROOT, PROJECT_NAME);
    assert(fs.existsSync(projectRoot), `real app project not found: ${projectRoot}`);

    const scene = buildScene(projectRoot);
    const plan = buildArkMainPlan(scene);
    const unknownFacts = plan.facts.filter(fact => fact.entryFamily === "unknown_structural_callback");
    const report: AuditReport = {
        generatedAt: new Date().toISOString(),
        projectId: PROJECT_NAME,
        projectRoot,
        totalUnknownStructuralCallbacks: unknownFacts.length,
        reasons: [...new Set(unknownFacts.map(fact => fact.reason))].sort((a, b) => a.localeCompare(b)),
    };

    const outputDir = path.resolve("tmp/entry_model_real_app_unknown_structural_audit");
    ensureDir(outputDir);
    const outputPath = path.join(outputDir, projectConfig.outputFileName);
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf8");

    console.log(`project=${PROJECT_NAME}`);
    console.log(`unknown_structural_callbacks=${report.totalUnknownStructuralCallbacks}`);
    console.log(`report=${outputPath}`);

    assert(
        unknownFacts.length === 0,
        `unknown structural callback facts must not be produced, got ${unknownFacts.length}`,
    );
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
