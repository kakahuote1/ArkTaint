import * as fs from "fs";
import * as path from "path";
import { loadModules } from "../../core/orchestration/modules/ModuleLoader";
import { loadEnginePlugins } from "../../core/orchestration/plugins/EnginePluginLoader";

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
    const moduleDir = path.join(root, "modules");
    const pluginDir = path.join(root, "plugins");
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(moduleDir, { recursive: true });
    fs.mkdirSync(pluginDir, { recursive: true });

    writeFile(path.join(moduleDir, "kernel", "README.md"), "# allowed helper doc\n");
    writeFile(path.join(moduleDir, "kernel", "noise.bin"), "not-a-module");
    writeFile(path.join(moduleDir, "kernel", "broken.ts"), "export default {\n");
    writeFile(path.join(moduleDir, "kernel", "helper.ts"), "export const value = 1;\n");

    writeFile(path.join(pluginDir, "README.md"), "# allowed helper doc\n");
    writeFile(path.join(pluginDir, "noise.bin"), "not-a-plugin");
    writeFile(path.join(pluginDir, "broken.ts"), "export default {\n");
    writeFile(path.join(pluginDir, "helper.ts"), "export const value = 1;\n");

    const moduleLoad = loadModules({
        includeBuiltinModules: false,
        moduleRoots: [moduleDir],
    });
    assert(moduleLoad.modules.length === 0, "junk-only module dir should not load modules");
    assert(
        moduleLoad.warnings.some(item => item.includes("non-TypeScript file ignored") && item.includes("noise.bin")),
        "module loader should soft-warn on unexpected non-TypeScript files",
    );
    assert(
        moduleLoad.warnings.some(item => item.includes("TypeScript file ignored due to syntax/encoding issue") && item.includes("broken.ts")),
        "module loader should soft-warn on invalid TypeScript files",
    );
    assert(
        !moduleLoad.warnings.some(item => item.includes("README.md")),
        "module loader should not warn on allowed helper docs",
    );
    assert(
        moduleLoad.warnings.some(item => item.includes("exported no loadable modules") && item.includes("helper.ts")),
        "module loader should warn when a TypeScript file exports no modules",
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

