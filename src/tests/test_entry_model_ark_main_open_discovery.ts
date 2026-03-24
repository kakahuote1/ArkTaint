import * as fs from "fs";
import * as path from "path";
import { Scene } from "../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../arkanalyzer/out/src/Config";
import { buildArkMainPlan } from "../core/entry/arkmain/ArkMainPlanner";
import { classifyArkMainFactOwnership, isArkMainEntryLayerFact } from "../core/entry/arkmain/ArkMainTypes";
import { registerMockSdkFiles } from "./helpers/TestSceneBuilder";

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

function assert(condition: unknown, message: string): void {
    if (!condition) {
        throw new Error(message);
    }
}

async function main(): Promise<void> {
    const scene = buildScene(path.resolve("tests/demo/sdk_callback_provenance_probe"));
    const seedMethods = scene.getMethods().filter(method => /^sdk_callback_provenance_\d+_T$/.test(method.getName?.() || ""));
    assert(seedMethods.length >= 3, `expected sdk callback probe seed methods, got ${seedMethods.length}`);
    const plan = buildArkMainPlan(scene, { seedMethods });

    const unknownSdkCallbacks = plan.facts.filter(fact =>
        fact.kind === "callback"
        && fact.callbackRecognitionLayer === "sdk_provenance"
        && fact.entryFamily === "unknown_sdk_callback",
    );

    assert(unknownSdkCallbacks.length > 0, "ArkMain should preserve unknown sdk callback candidates as unknown_sdk_callback facts.");

    const sourceMethodNames = new Set(
        unknownSdkCallbacks.map(fact => fact.sourceMethod?.getName?.()).filter(Boolean) as string[],
    );
    assert(
        sourceMethodNames.has("sdk_callback_provenance_001_T"),
        `unknown_sdk_callback facts should include createAVPlayer-style source method. actual=${[...sourceMethodNames].join(", ")}`,
    );
    assert(
        sourceMethodNames.has("sdk_callback_provenance_004_T"),
        `unknown_sdk_callback facts should include WebMessagePort-style source method. actual=${[...sourceMethodNames].join(", ")}`,
    );

    for (const fact of unknownSdkCallbacks) {
        assert(
            classifyArkMainFactOwnership(fact) === "root_entry",
            `unknown_sdk_callback must remain root_entry, got ${classifyArkMainFactOwnership(fact)}`,
        );
        assert(
            isArkMainEntryLayerFact(fact),
            "unknown_sdk_callback must remain inside ArkMain entry layer.",
        );
        assert(
            fact.entryShape !== undefined,
            "unknown_sdk_callback facts should preserve registration shape metadata.",
        );
    }

    const externalScene = buildScene(path.resolve("tests/demo/arkmain_external_callback"));
    const externalSeedMethods = externalScene.getMethods().filter(method =>
        /^opaque_external_callback(_nested)?_\d+_T$/.test(method.getName?.() || ""),
    );
    assert(externalSeedMethods.length === 2, `expected 2 external callback probe seeds, got ${externalSeedMethods.length}`);
    const externalPlan = buildArkMainPlan(externalScene, { seedMethods: externalSeedMethods });
    const unknownExternalCallbacks = externalPlan.facts.filter(fact =>
        fact.kind === "callback"
        && fact.callbackRecognitionLayer === "opaque_external_call_fallback"
        && fact.entryFamily === "unknown_external_callback",
    );
    assert(
        unknownExternalCallbacks.length >= 3,
        `ArkMain should discover direct + nested external callbacks, got ${unknownExternalCallbacks.length}`,
    );
    const externalMethodNames = new Set(unknownExternalCallbacks.map(fact => fact.method.getName?.() || ""));
    assert(
        externalMethodNames.has("directLeaf001"),
        `unknown_external_callback facts should include direct external callback target. actual=${[...externalMethodNames].join(", ")}`,
    );
    assert(
        externalMethodNames.has("nestedLeaf001"),
        `unknown_external_callback facts should include nested external callback target via worklist scanning. actual=${[...externalMethodNames].join(", ")}`,
    );
    for (const fact of unknownExternalCallbacks) {
        assert(
            classifyArkMainFactOwnership(fact) === "root_entry",
            `unknown_external_callback must remain root_entry, got ${classifyArkMainFactOwnership(fact)}`,
        );
        assert(
            isArkMainEntryLayerFact(fact),
            "unknown_external_callback must remain inside ArkMain entry layer.",
        );
    }
    const orderedExternalMethodNames = new Set(externalPlan.orderedMethods.map(method => method.getName?.() || ""));
    assert(
        orderedExternalMethodNames.has("nestedLeaf001"),
        `ArkMain orderedMethods should include nested external callback target. actual=${[...orderedExternalMethodNames].join(", ")}`,
    );

    console.log("PASS test_entry_model_ark_main_open_discovery");
    console.log(`unknown_sdk_callbacks=${unknownSdkCallbacks.length}`);
    console.log(`unknown_external_callbacks=${unknownExternalCallbacks.length}`);
}

main().catch(error => {
    console.error("FAIL test_entry_model_ark_main_open_discovery");
    console.error(error);
    process.exit(1);
});
