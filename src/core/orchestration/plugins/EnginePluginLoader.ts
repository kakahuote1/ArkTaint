import * as fs from "fs";
import * as path from "path";
import { EnginePlugin } from "./EnginePlugin";
import {
    auditExtensionDirectoryFiles,
    collectTypeScriptImportRecords,
    collectTypeScriptSourceFiles,
    ExtensionModuleLoadIssue,
    filterTypeScriptSourceFilesByMarkers,
    getExtensionSourceModulePath,
    loadExtensionCandidatesFromModule,
    pushLoaderWarning,
    resolveExistingDirectories,
    resolveLoadableTypeScriptModule,
    resolvePublicPluginApiPath,
} from "../ExtensionLoaderUtils";

export interface EnginePluginLoaderOptions {
    includeBuiltinPlugins?: boolean;
    builtinPluginDirs?: string[];
    pluginDirs?: string[];
    pluginFiles?: string[];
    plugins?: EnginePlugin[];
    disabledPluginNames?: string[];
    isolatePluginNames?: string[];
    onWarning?: (warning: string) => void;
}

export interface EnginePluginLoadResult {
    plugins: EnginePlugin[];
    loadedFiles: string[];
    warnings: string[];
    loadIssues: ExtensionModuleLoadIssue[];
}

export interface EnginePluginCatalogEntry {
    name: string;
    description?: string;
    source: PluginSelectionSource;
    sourcePath?: string;
    enabledByFile: boolean;
    effectiveStatus: "active" | "disabled_by_file" | "disabled_by_cli" | "isolate_filtered" | "overridden";
}

export interface EnginePluginInspectResult {
    catalog: EnginePluginCatalogEntry[];
    warnings: string[];
    loadIssues: ExtensionModuleLoadIssue[];
}

interface LoadedEnginePluginCandidate {
    plugin: EnginePlugin;
    enabled: boolean;
}

interface LoadedEnginePluginModuleResult {
    candidates: LoadedEnginePluginCandidate[];
    loadIssue?: ExtensionModuleLoadIssue;
}

type PluginSelectionSource = "builtin" | "external" | "explicit";

interface SelectedEnginePlugin {
    plugin: EnginePlugin;
    source: PluginSelectionSource;
}

const PUBLIC_EXTERNAL_PLUGIN_API_FILES = new Set<string>([
    resolvePublicPluginApiPath(),
]);

export function loadEnginePlugins(options: EnginePluginLoaderOptions = {}): EnginePluginLoadResult {
    const warnings: string[] = [];
    const selectedPlugins = new Map<string, SelectedEnginePlugin>();
    const attemptedModules = new Set<string>();
    const loadedFiles = new Set<string>();
    const loadIssues: ExtensionModuleLoadIssue[] = [];
    const discoveredPluginNames = new Set<string>();
    const builtinPluginFiles = new Set<string>();
    const externalPluginFiles = new Set<string>();
    const externalPluginRoots = new Map<string, string>();
    const disabledPluginNames = new Set((options.disabledPluginNames || []).map(name => name.trim()).filter(Boolean));
    const isolateNames = new Set((options.isolatePluginNames || []).map(name => name.trim()).filter(Boolean));
    const discoveredIsolateMatches = new Set<string>();

    if (options.includeBuiltinPlugins !== false) {
        for (const dir of getBuiltinPluginDirs(options.builtinPluginDirs)) {
            auditExtensionDirectoryFiles(dir, "engine plugin", warnings, options.onWarning);
            for (const file of collectPluginFiles(dir)) {
                builtinPluginFiles.add(file);
            }
        }
    }

    for (const dir of options.pluginDirs || []) {
        const abs = path.resolve(dir);
        if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
            externalPluginFiles.add(abs);
            continue;
        }
        auditExtensionDirectoryFiles(abs, "engine plugin", warnings, options.onWarning);
        for (const file of collectPluginFiles(abs)) {
            externalPluginFiles.add(file);
        }
    }

    for (const file of options.pluginFiles || []) {
        externalPluginFiles.add(path.resolve(file));
    }

    for (const file of [...builtinPluginFiles.values(), ...externalPluginFiles.values()]) {
        if (externalPluginFiles.has(file)) {
            const auditIssue = auditExternalPluginImports(
                file,
                externalPluginRoots.get(file) || path.dirname(file),
                warnings,
                options.onWarning,
            );
            if (auditIssue) {
                loadIssues.push(auditIssue);
                continue;
            }
        }
        const modulePath = resolveLoadablePluginModule(file);
        if (!modulePath) {
            pushLoaderWarning(warnings, options.onWarning, `engine plugin file not loadable: ${file}`);
            continue;
        }
        if (attemptedModules.has(modulePath)) continue;
        attemptedModules.add(modulePath);
        const plugins = loadPluginsFromModule(modulePath, warnings, options.onWarning);
        if (plugins.loadIssue) {
            loadIssues.push(plugins.loadIssue);
        }
        if (plugins.candidates.length > 0) {
            loadedFiles.add(modulePath);
        }
        for (const candidate of plugins.candidates) {
            const plugin = candidate.plugin;
            discoveredPluginNames.add(plugin.name);
            if (!candidate.enabled) {
                continue;
            }
            if (disabledPluginNames.has(plugin.name)) {
                continue;
            }
            if (isolateNames.size > 0 && !isolateNames.has(plugin.name)) {
                continue;
            }
            if (isolateNames.has(plugin.name)) {
                discoveredIsolateMatches.add(plugin.name);
            }
            registerEnginePlugin(
                selectedPlugins,
                plugin,
                builtinPluginFiles.has(file) ? "builtin" : "external",
                warnings,
                options.onWarning,
            );
        }
    }

    for (const plugin of options.plugins || []) {
        if (!plugin?.name) continue;
        discoveredPluginNames.add(plugin.name);
        if (disabledPluginNames.has(plugin.name)) {
            continue;
        }
        if (isolateNames.size > 0 && !isolateNames.has(plugin.name)) {
            continue;
        }
        if (isolateNames.has(plugin.name)) {
            discoveredIsolateMatches.add(plugin.name);
        }
        registerEnginePlugin(selectedPlugins, plugin, "explicit", warnings, options.onWarning);
    }

    for (const pluginName of isolateNames) {
        if (!discoveredIsolateMatches.has(pluginName)) {
            pushLoaderWarning(warnings, options.onWarning, `requested engine plugin not found: ${pluginName}`);
        }
    }
    for (const pluginName of disabledPluginNames) {
        if (!discoveredPluginNames.has(pluginName)) {
            pushLoaderWarning(warnings, options.onWarning, `requested engine plugin not found: ${pluginName}`);
        }
    }

    return {
        plugins: [...selectedPlugins.values()].map(item => item.plugin),
        loadedFiles: [...loadedFiles.values()].sort((a, b) => a.localeCompare(b)),
        warnings,
        loadIssues,
    };
}

export function inspectEnginePlugins(options: EnginePluginLoaderOptions = {}): EnginePluginInspectResult {
    const warnings: string[] = [];
    const attemptedModules = new Set<string>();
    const loadIssues: ExtensionModuleLoadIssue[] = [];
    const catalog: Array<EnginePluginCatalogEntry & { order: number }> = [];
    const builtinPluginFiles = new Set<string>();
    const externalPluginFiles = new Set<string>();
    const externalPluginRoots = new Map<string, string>();
    const disabledPluginNames = new Set((options.disabledPluginNames || []).map(name => name.trim()).filter(Boolean));
    const isolateNames = new Set((options.isolatePluginNames || []).map(name => name.trim()).filter(Boolean));
    let order = 0;

    if (options.includeBuiltinPlugins !== false) {
        for (const dir of getBuiltinPluginDirs(options.builtinPluginDirs)) {
            auditExtensionDirectoryFiles(dir, "engine plugin", warnings, options.onWarning);
            for (const file of collectPluginFiles(dir)) {
                builtinPluginFiles.add(file);
            }
        }
    }

    for (const dir of options.pluginDirs || []) {
        const abs = path.resolve(dir);
        if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
            externalPluginFiles.add(abs);
            externalPluginRoots.set(abs, path.dirname(abs));
            continue;
        }
        auditExtensionDirectoryFiles(abs, "engine plugin", warnings, options.onWarning);
        for (const file of collectPluginFiles(abs)) {
            externalPluginFiles.add(file);
            externalPluginRoots.set(file, abs);
        }
    }

    for (const file of options.pluginFiles || []) {
        const abs = path.resolve(file);
        externalPluginFiles.add(abs);
        externalPluginRoots.set(abs, path.dirname(abs));
    }

    const pushCandidate = (plugin: EnginePlugin, enabledByFile: boolean, source: PluginSelectionSource): void => {
        catalog.push({
            order: order++,
            name: plugin.name,
            description: plugin.description,
            source,
            sourcePath: getExtensionSourceModulePath(plugin),
            enabledByFile,
            effectiveStatus: "active",
        });
    };

    const inspectFile = (file: string, source: PluginSelectionSource, importRootDir?: string): void => {
        if (source === "external" && importRootDir) {
            const auditIssue = auditExternalPluginImports(file, importRootDir, warnings, options.onWarning);
            if (auditIssue) {
                loadIssues.push(auditIssue);
                return;
            }
        }
        const modulePath = resolveLoadablePluginModule(file);
        if (!modulePath) {
            pushLoaderWarning(warnings, options.onWarning, `engine plugin file not loadable: ${file}`);
            return;
        }
        if (attemptedModules.has(modulePath)) return;
        attemptedModules.add(modulePath);
        const loaded = loadPluginsFromModule(modulePath, warnings, options.onWarning);
        if (loaded.loadIssue) {
            loadIssues.push(loaded.loadIssue);
        }
        for (const candidate of loaded.candidates) {
            pushCandidate(candidate.plugin, candidate.enabled, source);
        }
    };

    for (const file of builtinPluginFiles.values()) {
        inspectFile(file, "builtin");
    }
    for (const file of externalPluginFiles.values()) {
        inspectFile(file, "external", externalPluginRoots.get(file) || path.dirname(file));
    }
    for (const plugin of options.plugins || []) {
        if (!plugin?.name) continue;
        pushCandidate(plugin, plugin.enabled !== false, "explicit");
    }

    const selectedIndexByName = new Map<string, number>();
    for (const [index, entry] of catalog.entries()) {
        if (!entry.enabledByFile) continue;
        if (disabledPluginNames.has(entry.name)) continue;
        if (isolateNames.size > 0 && !isolateNames.has(entry.name)) continue;
        selectedIndexByName.set(entry.name, index);
    }

    for (const [index, entry] of catalog.entries()) {
        if (!entry.enabledByFile) {
            entry.effectiveStatus = "disabled_by_file";
            continue;
        }
        if (disabledPluginNames.has(entry.name)) {
            entry.effectiveStatus = "disabled_by_cli";
            continue;
        }
        if (isolateNames.size > 0 && !isolateNames.has(entry.name)) {
            entry.effectiveStatus = "isolate_filtered";
            continue;
        }
        entry.effectiveStatus = selectedIndexByName.get(entry.name) === index ? "active" : "overridden";
    }

    return {
        catalog: catalog
            .sort((a, b) => a.name.localeCompare(b.name) || a.order - b.order)
            .map(({ order: _order, ...entry }) => entry),
        warnings,
        loadIssues,
    };
}

function getBuiltinPluginDirs(explicitDirs?: string[]): string[] {
    const explicit = resolveExistingDirectories(explicitDirs);
    if (explicit.length > 0) {
        return explicit;
    }

    const preferredSourceDir = path.resolve(__dirname, "../../../../src/plugins");
    if (fs.existsSync(preferredSourceDir) && fs.statSync(preferredSourceDir).isDirectory()) {
        return [preferredSourceDir];
    }

    return [];
}

function collectPluginFiles(rootDir: string): string[] {
    return filterTypeScriptSourceFilesByMarkers(
        collectTypeScriptSourceFiles(rootDir),
        ["defineEnginePlugin"],
    );
}

function resolveLoadablePluginModule(absPath: string): string | null {
    return resolveLoadableTypeScriptModule(absPath);
}

function loadPluginsFromModule(
    modulePath: string,
    warnings: string[],
    onWarning?: (warning: string) => void,
): LoadedEnginePluginModuleResult {
    const result = loadExtensionCandidatesFromModule<EnginePlugin>({
        modulePath,
        kindLabel: "engine plugin",
        warnings,
        onWarning,
        exportAliases: ["plugin"],
        isCandidate: isEnginePlugin,
        getId: candidate => candidate.name,
        isEnabled: candidate => candidate.enabled !== false,
    });
    return {
        candidates: result.candidates.map(candidate => ({
            plugin: candidate.value,
            enabled: candidate.enabled,
        })),
        loadIssue: result.loadIssue,
    };
}

function isEnginePlugin(value: any): value is EnginePlugin {
    return !!value
        && typeof value.name === "string"
        && value.name.trim().length > 0;
}

function registerEnginePlugin(
    selectedPlugins: Map<string, SelectedEnginePlugin>,
    plugin: EnginePlugin,
    source: PluginSelectionSource,
    warnings: string[],
    onWarning?: (warning: string) => void,
): void {
    const existing = selectedPlugins.get(plugin.name);
    if (existing) {
        pushLoaderWarning(
            warnings,
            onWarning,
            `engine plugin ${plugin.name} from ${describePluginSource(source)} overrides ${describePluginSource(existing.source)}`,
        );
    }
    selectedPlugins.set(plugin.name, { plugin, source });
}

function describePluginSource(source: PluginSelectionSource): string {
    switch (source) {
        case "builtin":
            return "builtin plugin";
        case "external":
            return "external plugin";
        case "explicit":
            return "explicit plugin object";
    }
    return "engine plugin";
}

function auditExternalPluginImports(
    filePath: string,
    pluginRootDir: string,
    warnings: string[],
    onWarning?: (warning: string) => void,
): ExtensionModuleLoadIssue | undefined {
    const normalizedFile = path.resolve(filePath);
    const normalizedPluginRoot = path.resolve(pluginRootDir);
    for (const record of collectTypeScriptImportRecords(normalizedFile)) {
        const resolvedPath = record.resolvedPath ? path.resolve(record.resolvedPath) : undefined;
        if (!resolvedPath) {
            continue;
        }
        if (resolvedPath.startsWith(normalizedPluginRoot)) {
            continue;
        }
        if (PUBLIC_EXTERNAL_PLUGIN_API_FILES.has(resolvedPath)) {
            continue;
        }
        if (!resolvedPath.startsWith(process.cwd())) {
            continue;
        }
        pushLoaderWarning(
            warnings,
            onWarning,
            `external plugin private import rejected: ${normalizedFile}:${record.line}:${record.column} -> ${record.specifier}`,
        );
        return {
            kindLabel: "engine plugin",
            modulePath: normalizedFile,
            phase: "module_load",
            message: `external plugin imports private ArkTaint internals: ${record.specifier}`,
            code: "PLUGIN_EXTERNAL_PRIVATE_IMPORT",
            advice: "External plugins may only import files from the same plugin directory or the public @arktaint/plugin API. Do not depend on private core/orchestration or kernel internals.",
            line: record.line,
            column: record.column,
            userMessage: `plugin author contract rejected private import @ ${normalizedFile}:${record.line}:${record.column}: ${record.specifier}`,
        };
    }
    return undefined;
}
