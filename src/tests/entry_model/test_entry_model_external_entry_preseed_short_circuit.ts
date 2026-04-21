import * as fs from "fs";
import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { buildArkMainPlan } from "../../core/entry/arkmain/ArkMainPlanner";
import type { ArkMainEntryFact } from "../../core/entry/arkmain/ArkMainTypes";
import { registerMockSdkFiles } from "../helpers/TestSceneBuilder";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
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

function writeFixture(projectDir: string): void {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, "taintMockAbility.ts"), [
        "export class UIAbility {",
        "  onCreate(want: string): void {}",
        "}",
        "",
    ].join("\n"), "utf8");
    fs.writeFileSync(path.join(projectDir, "entry.ets"), [
        "import { UIAbility } from './taintMockAbility';",
        "",
        "export class DemoAbility extends UIAbility {",
        "  onCreate(want: string): void {}",
        "}",
        "",
    ].join("\n"), "utf8");
}

async function main(): Promise<void> {
    const projectDir = path.resolve("tmp/test_runs/entry_model/preseed_short_circuit/latest/project");
    writeFixture(projectDir);
    const scene = buildScene(projectDir);
    const method = scene.getMethods().find(item => item.getName?.() === "onCreate" && item.getDeclaringArkClass?.()?.getName?.() === "DemoAbility");
    assert(method, "missing DemoAbility.onCreate");

    const fact: ArkMainEntryFact = {
        phase: "bootstrap",
        kind: "ability_lifecycle",
        method,
        ownerKind: "ability_owner",
        reason: "preseed semanticflow fact",
        schedule: true,
        entryFamily: "semanticflow",
        entryShape: "owner-slot",
        recognitionLayer: "semanticflow.pipeline",
    };

    const result = buildArkMainPlan(scene, {
        seededMethods: [method],
        seededFacts: [fact],
    });

    assert(result.orderedMethods.length > 0, "preseeded arkmain plan should keep ordered methods");
    assert(result.facts.some(item => item.method === method && item.kind === "ability_lifecycle"), "preseeded fact should be preserved");

    console.log("PASS test_entry_model_external_entry_preseed_short_circuit");
}

main().catch(error => {
    console.error("FAIL test_entry_model_external_entry_preseed_short_circuit");
    console.error(error);
    process.exit(1);
});
