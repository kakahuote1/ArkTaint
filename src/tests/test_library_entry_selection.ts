import { Scene } from "../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../arkanalyzer/out/src/Config";
import { selectEntryCandidates } from "../cli/analyzeUtils";
import * as path from "path";

async function main(): Promise<void> {
    const sourceDir = path.resolve("tests/demo/library_entry_mode");
    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(sourceDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(sceneConfig);
    scene.inferTypes();

    const selection = selectEntryCandidates(
        scene,
        {
            entryHints: [],
            includePaths: [],
            excludePaths: [],
            maxEntries: 1,
        },
        /^taint_src$/,
        sourceDir
    );

    if (selection.selected.length === 0) {
        throw new Error("No entry selected in library mode test.");
    }

    const top = selection.selected[0];
    if (top.name !== "z_exported_entry") {
        throw new Error(`Expected top entry to be z_exported_entry, got ${top.name}`);
    }

    console.log("PASS library entry selection");
    console.log(`selected=${top.name}`);
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
