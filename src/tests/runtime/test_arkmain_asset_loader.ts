import * as fs from "fs";
import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { loadArkMainSeeds } from "../../core/entry/arkmain/ArkMainLoader";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function writeFixture(projectDir: string): void {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, "asset_loader.ets"), [
        "export class UIAbility {",
        "  onCreate(want: string): void {}",
        "}",
        "",
        "export class DemoAbility extends UIAbility {",
        "  onCreate(want: string): void {}",
        "}",
        "",
    ].join("\n"), "utf8");
}

function buildScene(projectDir: string): Scene {
    const config = new SceneConfig();
    config.buildFromProjectDir(projectDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    return scene;
}

async function main(): Promise<void> {
    const root = path.resolve("tmp/test_runs/runtime/arkmain_asset_loader/latest");
    const projectDir = path.join(root, "project");
    const arkMainRoot = path.join(root, "arkmain_assets");
    const projectAssetDir = path.join(arkMainRoot, "project", "shared_entry", "arkmain");
    writeFixture(projectDir);
    fs.mkdirSync(projectAssetDir, { recursive: true });
    fs.writeFileSync(path.join(projectAssetDir, "semanticflow.arkmain.json"), JSON.stringify({
        schemaVersion: 1,
        entries: [
            {
                selector: {
                    methodName: "onCreate",
                    parameterTypes: ["string"],
                    returnType: "void",
                    superClassName: "UIAbility",
                },
                entryPattern: {
                    phase: "bootstrap",
                    kind: "ability_lifecycle",
                    ownerKind: "ability_owner",
                    reason: "shared arkmain asset",
                    entryFamily: "semanticflow",
                    entryShape: "owner-slot",
                },
            },
        ],
    }, null, 2), "utf8");

    const scene = buildScene(projectDir);
    const result = loadArkMainSeeds(scene, {
        includeBuiltinArkMain: false,
        arkMainRoots: [arkMainRoot],
        enabledArkMainProjects: ["shared_entry"],
    });

    assert(result.methods.length === 1, `expected one arkmain method, got ${result.methods.length}`);
    assert(result.facts.length === 1, `expected one arkmain fact, got ${result.facts.length}`);
    assert(result.facts[0].kind === "ability_lifecycle", `unexpected fact kind: ${result.facts[0].kind}`);
    assert(result.discoveredArkMainProjects.includes("shared_entry"), "expected shared_entry to be discovered");
    assert(result.enabledArkMainProjects.includes("shared_entry"), "expected shared_entry to be enabled");

    console.log("PASS test_arkmain_asset_loader");
}

main().catch(error => {
    console.error("FAIL test_arkmain_asset_loader");
    console.error(error);
    process.exit(1);
});
