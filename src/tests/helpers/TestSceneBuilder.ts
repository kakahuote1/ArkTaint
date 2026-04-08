import * as path from "path";
import { Scene } from "../../../arkanalyzer/lib/Scene";
import { SceneConfig } from "../../../arkanalyzer/lib/Config";
import { injectArkUiSdk } from "../../core/orchestration/ArkUiSdkConfig";

/**
 * Registers taint_mock files as SDK files in the Scene's internal map.
 * This allows SDK provenance detection to work correctly in test
 * environments where framework classes (UIInput, Router, UIAbility, etc.)
 * are defined in local mock files rather than in actual HarmonyOS SDK
 * directories.
 *
 * In real projects, these classes come from @kit.ArkUI / @ohos.router
 * and are naturally in the SDK file map. This bridges the gap for tests.
 *
 * Only files whose basename starts with "taint_mock" are registered,
 * preserving the distinction between SDK-backed and project-local classes.
 */
export function registerMockSdkFiles(scene: Scene): void {
    const sdkMap = (scene as any).sdkArkFilesMap as Map<string, any> | undefined;
    if (!sdkMap) {
        return;
    }
    for (const file of scene.getFiles()) {
        const filePath = file.getFilePath?.() || "";
        const fileName = path.basename(filePath);
        if (/^taint_mock\b/.test(fileName)) {
            const fileSig = file.getFileSignature?.();
            if (fileSig) {
                sdkMap.set(fileSig.toMapKey(), file);
            }
        }
    }
}

/**
 * Build a Scene from a project directory with taint_mock files
 * automatically registered as SDK files for test environments.
 */
export function buildTestScene(projectDir: string): Scene {
    const config = new SceneConfig();
    config.buildFromProjectDir(projectDir);
    injectArkUiSdk(config);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    registerMockSdkFiles(scene);
    return scene;
}
