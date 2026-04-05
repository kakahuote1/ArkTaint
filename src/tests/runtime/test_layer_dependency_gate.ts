import * as fs from "fs";
import * as path from "path";

type LayerId = "L1" | "L2" | "L4" | "L6" | "L7";

interface ImportEdge {
    fromFile: string;
    toFile: string;
    fromLayer: LayerId;
    toLayer: LayerId;
}

const CORE_ROOT = path.resolve("src/core");
const RULE_ROOT = path.resolve("src/rules");
const MODULE_ROOT = path.resolve("src/modules");
const PLUGIN_ROOT = path.resolve("src/plugins");
const ALLOWED_MODULE_CORE_IMPORTS = new Set<string>([
    "src/core/kernel/contracts/ModuleApi.ts",
    "src/core/kernel/contracts/ModuleContract.ts",
    "src/core/kernel/contracts/ModuleCarrierResolution.ts",
    "src/core/kernel/contracts/ModuleEmissionUtils.ts",
    "src/core/kernel/contracts/HarmonyModuleUtils.ts",
    "src/core/kernel/contracts/AbilityHandoffModuleProvider.ts",
    "src/core/kernel/contracts/AppStorageModuleProvider.ts",
    "src/core/kernel/contracts/EmitterModuleProvider.ts",
    "src/core/kernel/contracts/RouterModuleProvider.ts",
    "src/core/kernel/contracts/StateModuleProvider.ts",
    "src/core/kernel/contracts/WorkerTaskPoolModuleProvider.ts",
    "src/core/kernel/contracts/MethodLookup.ts",
    "src/core/kernel/contracts/PagNodeResolution.ts",
]);
const LEGACY_ALLOWED_VIOLATIONS = new Set<string>([
]);

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function normalizeFile(absPath: string): string {
    return path.relative(process.cwd(), absPath).replace(/\\/g, "/");
}

function collectTypeScriptFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...collectTypeScriptFiles(fullPath));
            continue;
        }
        if (entry.isFile() && fullPath.endsWith(".ts") && !fullPath.endsWith(".d.ts")) {
            out.push(fullPath);
        }
    }
    return out;
}

function extractImportSpecifiers(fileText: string): string[] {
    const out = new Set<string>();
    const fromPattern = /\b(?:import|export)\s+(?:type\s+)?[\s\S]*?\bfrom\s+["']([^"']+)["']/g;
    const requirePattern = /\brequire\(\s*["']([^"']+)["']\s*\)/g;

    let match: RegExpExecArray | null;
    while ((match = fromPattern.exec(fileText)) !== null) {
        out.add(match[1]);
    }
    while ((match = requirePattern.exec(fileText)) !== null) {
        out.add(match[1]);
    }
    return [...out.values()];
}

function resolveImportTarget(fromFile: string, specifier: string): string | null {
    if (!specifier.startsWith(".")) {
        return null;
    }
    const basePath = path.resolve(path.dirname(fromFile), specifier);
    const candidates = [
        basePath,
        `${basePath}.ts`,
        `${basePath}.js`,
        path.join(basePath, "index.ts"),
        path.join(basePath, "index.js"),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return candidate;
        }
    }
    return null;
}

function resolveLayerId(absPath: string): LayerId | null {
    const normalized = normalizeFile(absPath);
    if (normalized.startsWith("src/core/orchestration/")) return "L7";
    if (normalized.startsWith("src/core/substrate/")) return "L1";
    if (normalized.startsWith("src/core/entry/")) return "L2";
    if (normalized.startsWith("src/core/rules/")) return "L6";
    if (normalized.startsWith("src/core/kernel/")) return "L4";
    return null;
}

function collectCrossRootImports(rootDir: string): ImportEdge[] {
    if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
        return [];
    }

    const files = collectTypeScriptFiles(rootDir);
    const imports: ImportEdge[] = [];
    for (const file of files) {
        const text = fs.readFileSync(file, "utf8");
        for (const specifier of extractImportSpecifiers(text)) {
            const targetFile = resolveImportTarget(file, specifier);
            if (!targetFile) continue;
            if (!targetFile.startsWith(CORE_ROOT)) continue;
            const toLayer = resolveLayerId(targetFile);
            if (!toLayer) continue;
            imports.push({
                fromFile: normalizeFile(file),
                toFile: normalizeFile(targetFile),
                fromLayer: "L7",
                toLayer,
            });
        }
    }
    return imports.sort((a, b) => {
        const left = `${a.fromFile} -> ${a.toFile}`;
        const right = `${b.fromFile} -> ${b.toFile}`;
        return left.localeCompare(right);
    });
}

function isAllowedLayerDependency(fromLayer: LayerId, toLayer: LayerId): boolean {
    if (fromLayer === "L7") return true;
    const allowed: Record<Exclude<LayerId, "L7">, Set<LayerId>> = {
        L1: new Set(["L1"]),
        L2: new Set(["L1", "L2"]),
        L4: new Set(["L1", "L4", "L6"]),
        L6: new Set(["L6"]),
    };
    return allowed[fromLayer].has(toLayer);
}

function collectForbiddenModuleSupportSpecifiers(rootDir: string): Array<{ fromFile: string; specifier: string }> {
    if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
        return [];
    }
    const files = collectTypeScriptFiles(rootDir);
    const violations: Array<{ fromFile: string; specifier: string }> = [];
    for (const file of files) {
        const text = fs.readFileSync(file, "utf8");
        for (const specifier of extractImportSpecifiers(text)) {
            if (!specifier.includes("module_support")) continue;
            violations.push({
                fromFile: normalizeFile(file),
                specifier,
            });
        }
    }
    return violations.sort((a, b) => {
        const left = `${a.fromFile} -> ${a.specifier}`;
        const right = `${b.fromFile} -> ${b.specifier}`;
        return left.localeCompare(right);
    });
}

function collectIllegalImports(): ImportEdge[] {
    const files = collectTypeScriptFiles(CORE_ROOT);
    const illegal: ImportEdge[] = [];
    for (const file of files) {
        const fromLayer = resolveLayerId(file);
        if (!fromLayer) continue;
        const text = fs.readFileSync(file, "utf8");
        for (const specifier of extractImportSpecifiers(text)) {
            const targetFile = resolveImportTarget(file, specifier);
            if (!targetFile) continue;
            if (!targetFile.startsWith(CORE_ROOT)) continue;
            const toLayer = resolveLayerId(targetFile);
            if (!toLayer) continue;
            if (isAllowedLayerDependency(fromLayer, toLayer)) continue;
            illegal.push({
                fromFile: normalizeFile(file),
                toFile: normalizeFile(targetFile),
                fromLayer,
                toLayer,
            });
        }
    }
    return illegal.sort((a, b) => {
        const left = `${a.fromFile} -> ${a.toFile}`;
        const right = `${b.fromFile} -> ${b.toFile}`;
        return left.localeCompare(right);
    });
}

function isAllowedModuleImport(edge: ImportEdge): boolean {
    return ALLOWED_MODULE_CORE_IMPORTS.has(edge.toFile);
}

function isAllowedRuleImport(edge: ImportEdge): boolean {
    return edge.toFile === "src/core/rules/RuleSchema.ts";
}

function isAllowedPluginImport(edge: ImportEdge): boolean {
    return edge.toFile === "src/core/orchestration/plugins/EnginePlugin.ts";
}

async function main(): Promise<void> {
    const illegalImports = collectIllegalImports();
    const ruleImports = collectCrossRootImports(RULE_ROOT);
    const moduleImports = collectCrossRootImports(MODULE_ROOT);
    const pluginImports = collectCrossRootImports(PLUGIN_ROOT);
    const actualSet = new Set(illegalImports.map(edge => `${edge.fromFile} -> ${edge.toFile}`));
    const unexpected = illegalImports.filter(edge => !LEGACY_ALLOWED_VIOLATIONS.has(`${edge.fromFile} -> ${edge.toFile}`));
    const resolvedLegacy = [...LEGACY_ALLOWED_VIOLATIONS.values()]
        .filter(item => !actualSet.has(item))
        .sort((a, b) => a.localeCompare(b));
    const unexpectedRuleImports = ruleImports.filter(edge => !isAllowedRuleImport(edge));
    const unexpectedModuleImports = moduleImports.filter(edge => !isAllowedModuleImport(edge));
    const unexpectedPluginImports = pluginImports.filter(edge => !isAllowedPluginImport(edge));
    const forbiddenModuleSupportSpecifiers = collectForbiddenModuleSupportSpecifiers(MODULE_ROOT);

    if (resolvedLegacy.length > 0) {
        console.log(`resolved_legacy_violations=${resolvedLegacy.length}`);
        for (const item of resolvedLegacy) {
            console.log(`  RESOLVED ${item}`);
        }
    }

    assert(
        unexpected.length === 0,
        `Layer dependency gate found unexpected cross-layer imports:\n${unexpected.map(edge =>
            `  ${edge.fromLayer} ${edge.fromFile} -> ${edge.toLayer} ${edge.toFile}`,
        ).join("\n")}`,
    );
    assert(
        unexpectedRuleImports.length === 0,
        `Layer dependency gate found unexpected rule -> core imports:\n${unexpectedRuleImports.map(edge =>
            `  RULE ${edge.fromFile} -> ${edge.toLayer} ${edge.toFile}`,
        ).join("\n")}`,
    );
    assert(
        unexpectedModuleImports.length === 0,
        `Layer dependency gate found unexpected module -> core imports:\n${unexpectedModuleImports.map(edge =>
            `  MODULE ${edge.fromFile} -> ${edge.toLayer} ${edge.toFile}`,
        ).join("\n")}`,
    );
    assert(
        unexpectedPluginImports.length === 0,
        `Layer dependency gate found unexpected plugin -> core imports:\n${unexpectedPluginImports.map(edge =>
            `  PLUGIN ${edge.fromFile} -> ${edge.toLayer} ${edge.toFile}`,
        ).join("\n")}`,
    );
    assert(
        forbiddenModuleSupportSpecifiers.length === 0,
        `Layer dependency gate found forbidden module_support imports under src/modules:\n${forbiddenModuleSupportSpecifiers.map(item =>
            `  MODULE ${item.fromFile} -> ${item.specifier}`,
        ).join("\n")}`,
    );

    console.log("PASS test_layer_dependency_gate");
    console.log(`legacy_violation_count=${illegalImports.length}`);
    console.log(`allowed_legacy_violations=${LEGACY_ALLOWED_VIOLATIONS.size}`);
    console.log(`rule_core_imports=${ruleImports.length}`);
    console.log(`module_core_imports=${moduleImports.length}`);
    console.log(`plugin_core_imports=${pluginImports.length}`);
}

main().catch(error => {
    console.error("FAIL test_layer_dependency_gate");
    console.error(error);
    process.exit(1);
});
