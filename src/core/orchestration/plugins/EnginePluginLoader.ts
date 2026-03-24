import * as fs from "fs";
import * as path from "path";
import { EnginePlugin } from "./EnginePlugin";
import {
    collectTypeScriptSourceFiles,
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
}

interface LoadedEnginePluginCandidate {
    plugin: EnginePlugin;
    enabled: boolean;
}

export function loadEnginePlugins(options: EnginePluginLoaderOptions = {}): EnginePluginLoadResult {
    const warnings: string[] = [];
    const discoveredPlugins: EnginePlugin[] = [];
    const attemptedModules = new Set<string>();
    const loadedFiles = new Set<string>();
    const discoveredPluginNames = new Set<string>();
    const builtinPluginFiles = new Set<string>();
    const externalPluginFiles = new Set<string>();
    const disabledPluginNames = new Set((options.disabledPluginNames || []).map(name => name.trim()).filter(Boolean));
    const isolateNames = new Set((options.isolatePluginNames || []).map(name => name.trim()).filter(Boolean));
    const discoveredIsolateMatches = new Set<string>();

    if (options.includeBuiltinPlugins !== false) {
        for (const dir of getBuiltinPluginDirs(options.builtinPluginDirs)) {
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
        if (plugins.length > 0) {
            loadedFiles.add(modulePath);
        }
        for (const candidate of plugins) {
            const plugin = candidate.plugin;
            if (discoveredPluginNames.has(plugin.name)) {
                pushLoaderWarning(
                    warnings,
                    options.onWarning,
                    `duplicate engine plugin name ${plugin.name}; keeping first discovered module`,
                );
                continue;
            }
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
            discoveredPlugins.push(plugin);
        }
    }

    for (const plugin of options.plugins || []) {
        if (!plugin?.name) continue;
        if (discoveredPluginNames.has(plugin.name)) {
            pushLoaderWarning(
                warnings,
                options.onWarning,
                `duplicate engine plugin name ${plugin.name}; keeping first discovered plugin object`,
            );
            continue;
        }
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
        discoveredPlugins.push(plugin);
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

    assertUniquePluginNames(discoveredPlugins);
    return {
        plugins: discoveredPlugins,
        loadedFiles: [...loadedFiles.values()].sort((a, b) => a.localeCompare(b)),
        warnings,
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
): LoadedEnginePluginCandidate[] {
    return loadExtensionCandidatesFromModule<EnginePlugin>({
        modulePath,
        kindLabel: "engine plugin",
        warnings,
        onWarning,
        exportAliases: ["plugin"],
        isCandidate: isEnginePlugin,
        getId: candidate => candidate.name,
        isEnabled: candidate => candidate.enabled !== false,
    }).map(candidate => ({
        plugin: candidate.value,
        enabled: candidate.enabled,
    }));
}

function isEnginePlugin(value: any): value is EnginePlugin {
    return !!value
        && typeof value.name === "string"
        && value.name.trim().length > 0;
}

function assertUniquePluginNames(plugins: EnginePlugin[]): void {
    const seen = new Set<string>();
    for (const plugin of plugins) {
        if (seen.has(plugin.name)) {
            throw new Error(`Duplicate engine plugin name: ${plugin.name}`);
        }
        seen.add(plugin.name);
    }
}
