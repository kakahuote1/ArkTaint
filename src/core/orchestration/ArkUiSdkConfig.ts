import * as fs from "fs";
import * as path from "path";

const ARKUI_SDK_NAME = "arkui-builtin";
const ARKUI_SDK_REL_PATH = "sdk/arkui";

export function getArkUiBuiltinSdkPath(): string | null {
    const fromProjectRoot = path.resolve(__dirname, "../../..", ARKUI_SDK_REL_PATH);
    if (fs.existsSync(fromProjectRoot)) {
        return fromProjectRoot;
    }
    const fromSrc = path.resolve(__dirname, "../..", ARKUI_SDK_REL_PATH);
    if (fs.existsSync(fromSrc)) {
        return fromSrc;
    }
    return null;
}

export function getArkUiBuiltinSdk(): { name: string; path: string; moduleName: string } | null {
    const sdkPath = getArkUiBuiltinSdkPath();
    if (!sdkPath) return null;
    return { name: ARKUI_SDK_NAME, path: sdkPath, moduleName: "" };
}

/**
 * Injects the bundled ArkUI SDK into a SceneConfig before scene construction.
 * This adds the SDK to both the SDK list (for file parsing) and
 * sdkGlobalFolders (for global type registration), so that arkanalyzer
 * recognizes ArkUI component types and their methods.
 */
export function injectArkUiSdk(config: { getSdksObj(): any[]; getOptions(): Record<string, any> }): void {
    const sdk = getArkUiBuiltinSdk();
    if (!sdk) return;
    config.getSdksObj().push(sdk);
    const opts = config.getOptions();
    if (!opts.sdkGlobalFolders) {
        opts.sdkGlobalFolders = [];
    }
    (opts.sdkGlobalFolders as string[]).push(sdk.path);
}
