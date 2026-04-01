import * as fs from "fs";
import * as path from "path";
import { loadSemanticPacks } from "../core/orchestration/packs/PackLoader";
import { loadEnginePlugins } from "../core/orchestration/plugins/EnginePluginLoader";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function writeFile(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf-8");
}

function main(): void {
    const root = path.resolve("tmp/test_runs/diagnostics/extension_loader_soft_warnings/latest");
    const packDir = path.join(root, "packs");
    const pluginDir = path.join(root, "plugins");
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(packDir, { recursive: true });
    fs.mkdirSync(pluginDir, { recursive: true });

    writeFile(path.join(packDir, "README.md"), "# allowed helper doc\n");
    writeFile(path.join(packDir, "noise.bin"), "not-a-pack");
    writeFile(path.join(packDir, "broken.ts"), "export default {\n");
    writeFile(path.join(packDir, "helper.ts"), "export const value = 1;\n");

    writeFile(path.join(pluginDir, "README.md"), "# allowed helper doc\n");
    writeFile(path.join(pluginDir, "noise.bin"), "not-a-plugin");
    writeFile(path.join(pluginDir, "broken.ts"), "export default {\n");
    writeFile(path.join(pluginDir, "helper.ts"), "export const value = 1;\n");

    const packLoad = loadSemanticPacks({
        includeBuiltinPacks: false,
        packDirs: [packDir],
    });
    assert(packLoad.packs.length === 0, "junk-only pack dir should not load semantic packs");
    assert(
        packLoad.warnings.some(item => item.includes("non-TypeScript file ignored") && item.includes("noise.bin")),
        "pack loader should soft-warn on unexpected non-TypeScript files",
    );
    assert(
        packLoad.warnings.some(item => item.includes("TypeScript file ignored due to syntax/encoding issue") && item.includes("broken.ts")),
        "pack loader should soft-warn on invalid TypeScript files",
    );
    assert(
        !packLoad.warnings.some(item => item.includes("README.md")),
        "pack loader should not warn on allowed helper docs",
    );
    assert(
        !packLoad.warnings.some(item => item.includes("helper.ts")),
        "pack loader should not warn on valid helper TypeScript files",
    );

    const pluginLoad = loadEnginePlugins({
        includeBuiltinPlugins: false,
        pluginDirs: [pluginDir],
    });
    assert(pluginLoad.plugins.length === 0, "junk-only plugin dir should not load plugins");
    assert(
        pluginLoad.warnings.some(item => item.includes("non-TypeScript file ignored") && item.includes("noise.bin")),
        "plugin loader should soft-warn on unexpected non-TypeScript files",
    );
    assert(
        pluginLoad.warnings.some(item => item.includes("TypeScript file ignored due to syntax/encoding issue") && item.includes("broken.ts")),
        "plugin loader should soft-warn on invalid TypeScript files",
    );
    assert(
        !pluginLoad.warnings.some(item => item.includes("README.md")),
        "plugin loader should not warn on allowed helper docs",
    );
    assert(
        !pluginLoad.warnings.some(item => item.includes("helper.ts")),
        "plugin loader should not warn on valid helper TypeScript files",
    );

    console.log("PASS test_extension_loader_soft_warnings");
}

main();

