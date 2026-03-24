import * as fs from "fs";
import * as path from "path";
import { Scene } from "../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../core/orchestration/TaintPropagationEngine";
import { SinkRule } from "../core/rules/RuleSchema";
import { registerMockSdkFiles } from "./helpers/TestSceneBuilder";

interface CaseSpec {
    caseName: string;
}

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function ensureDir(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
}

function isSemanticCaseFile(fileName: string): boolean {
    return /\.(ets|ts)$/.test(fileName) && /_(T|F)\./.test(fileName);
}

function createCaseView(sourceDir: string, caseName: string, outputRoot: string): string {
    const caseDir = path.join(outputRoot, caseName);
    fs.rmSync(caseDir, { recursive: true, force: true });
    ensureDir(caseDir);

    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const fileName = entry.name;
        const isCaseFile = fileName === `${caseName}.ets` || fileName === `${caseName}.ts`;
        if (!isCaseFile && isSemanticCaseFile(fileName)) continue;
        fs.copyFileSync(path.join(sourceDir, fileName), path.join(caseDir, fileName));
    }
    return caseDir;
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

async function runCase(projectDir: string): Promise<{
    autoSourceHintCount: number;
    seedCount: number;
    flowCount: number;
}> {
    const scene = buildScene(projectDir);
    const engine = new TaintPropagationEngine(scene, 1);
    engine.verbose = false;
    await engine.buildPAG({ entryModel: "arkMain" });

    const seedInfo = engine.propagateWithSourceRules([]);
    const sinkRules: SinkRule[] = [{
        id: "sink.unknown_callback.arg0",
        target: { endpoint: "arg0" },
        match: { kind: "method_name_equals", value: "Sink" },
    }];
    const flows = engine.detectSinksByRules(sinkRules);
    return {
        autoSourceHintCount: engine.getAutoSourceHintRules().length,
        seedCount: seedInfo.seedCount,
        flowCount: flows.length,
    };
}

async function main(): Promise<void> {
    const sourceDir = path.resolve("tests/demo/sdk_structural_fallback_realworld");
    const outputRoot = path.resolve("tmp/phase719/unknown_callback_source_hints");
    ensureDir(outputRoot);

    const cases: CaseSpec[] = [
        { caseName: "push_sdk_callback_001_T" },
        { caseName: "payment_sdk_callback_002_T" },
    ];

    for (const { caseName } of cases) {
        const projectDir = createCaseView(sourceDir, caseName, outputRoot);
        const ark = await runCase(projectDir);
        assert(ark.autoSourceHintCount > 0, `${caseName}: arkMain should produce auto source hints for unknown callbacks`);
        assert(ark.seedCount > 0, `${caseName}: arkMain should seed callback params via auto source hints`);
        assert(ark.flowCount > 0, `${caseName}: arkMain should detect sink flow via auto callback source hint`);
    }

    console.log("PASS test_entry_model_unknown_callback_source_hints");
}

main().catch(error => {
    console.error("FAIL test_entry_model_unknown_callback_source_hints");
    console.error(error);
    process.exit(1);
});
