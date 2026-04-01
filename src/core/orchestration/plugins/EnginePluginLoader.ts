import * as fs from "fs";
import * as path from "path";
import { EnginePlugin } from "./EnginePlugin";
import {
    auditExtensionDirectoryFiles,
    collectTypeScriptSourceFiles,
    ExtensionModuleLoadIssue,
    filterTypeScriptSourceFilesByMarkers,
    loadExtensionCandidatesFromModule,
    pushLoaderWarning,
    resolveExistingDirectories,
    resolveLoadableTypeScriptModule,
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

export function loadEnginePlugins(options: EnginePluginLoaderOptions = {}): EnginePluginLoadResult {
    const warnings: string[] = [];
    const selectedPlugins = new Map<string, SelectedEnginePlugin>();
    const attemptedModules = new Set<string>();
    const loadedFiles = new Set<string>();
    const loadIssues: ExtensionModuleLoadIssue[] = [];
    const discoveredPluginNames = new Set<string>();
    const builtinPluginFiles = new Set<string>();
    const externalPluginFiles = new Set<string>();
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
