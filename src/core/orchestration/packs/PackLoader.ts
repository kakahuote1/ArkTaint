import * as fs from "fs";
import * as path from "path";
import { SemanticPack } from "../../kernel/contracts/SemanticPack";
import {
    collectTypeScriptSourceFiles,
    filterTypeScriptSourceFilesByMarkers,
    loadExtensionCandidatesFromModule,
    pushLoaderWarning,
    resolveExistingDirectories,
    resolveLoadableTypeScriptModule,
} from "../ExtensionLoaderUtils";

export interface PackLoaderOptions {
    includeBuiltinPacks?: boolean;
    disabledPackIds?: string[];
    builtinPackDirs?: string[];
    packDirs?: string[];
    packFiles?: string[];
    packs?: SemanticPack[];
    onWarning?: (warning: string) => void;
}

export interface SemanticPackLoadResult {
    packs: SemanticPack[];
    loadedFiles: string[];
    warnings: string[];
}

interface LoadedSemanticPackCandidate {
    pack: SemanticPack;
    enabled: boolean;
}

export function loadSemanticPacks(options: PackLoaderOptions = {}): SemanticPackLoadResult {
    const warnings: string[] = [];
    const attemptedModules = new Set<string>();
    const loadedFiles = new Set<string>();
    const discoveredPacks: SemanticPack[] = [];
    const builtinPackFiles = new Set<string>();
    const externalPackFiles = new Set<string>();
    const disabledPackIds = new Set(options.disabledPackIds || []);
    const discoveredPackIds = new Set<string>();

    if (options.includeBuiltinPacks !== false) {
        for (const dir of getBuiltinPackDirs(options.builtinPackDirs)) {
            for (const file of collectPackFiles(dir)) {
                builtinPackFiles.add(file);
            }
        }
    }

    for (const dir of options.packDirs || []) {
        for (const file of collectPackFiles(path.resolve(dir))) {
            externalPackFiles.add(file);
        }
    }

    for (const file of options.packFiles || []) {
        externalPackFiles.add(path.resolve(file));
    }

    for (const file of builtinPackFiles) {
        const modulePath = resolveLoadablePackModule(file);
        if (!modulePath) {
            pushLoaderWarning(warnings, options.onWarning, `semantic pack file not loadable: ${file}`);
            continue;
        }
        if (attemptedModules.has(modulePath)) continue;
        attemptedModules.add(modulePath);
        const packs = loadPacksFromModule(modulePath, warnings, options.onWarning);
        if (packs.length > 0) {
            loadedFiles.add(modulePath);
        }
        for (const candidate of packs) {
            const pack = candidate.pack;
            if (discoveredPackIds.has(pack.id)) {
                pushLoaderWarning(
                    warnings,
                    options.onWarning,
                    `duplicate builtin semantic pack id ${pack.id}; keeping first discovered module`,
                );
                continue;
            }
            discoveredPackIds.add(pack.id);
            if (!candidate.enabled) {
                continue;
            }
            if (disabledPackIds.has(pack.id)) {
                continue;
            }
            discoveredPacks.push(pack);
        }
    }

    for (const file of externalPackFiles) {
        const modulePath = resolveLoadablePackModule(file);
        if (!modulePath) {
            pushLoaderWarning(warnings, options.onWarning, `semantic pack file not loadable: ${file}`);
            continue;
        }
        if (attemptedModules.has(modulePath)) continue;
        attemptedModules.add(modulePath);
        const packs = loadPacksFromModule(modulePath, warnings, options.onWarning);
        if (packs.length > 0) {
            loadedFiles.add(modulePath);
        }
        for (const candidate of packs) {
            const pack = candidate.pack;
            if (discoveredPackIds.has(pack.id)) {
                pushLoaderWarning(
                    warnings,
                    options.onWarning,
                    `duplicate semantic pack id ${pack.id}; keeping first discovered module`,
                );
                continue;
            }
            discoveredPackIds.add(pack.id);
            if (!candidate.enabled) {
                continue;
            }
            if (disabledPackIds.has(pack.id)) {
                continue;
            }
            discoveredPacks.push(pack);
        }
    }

    for (const packId of disabledPackIds) {
        if (!discoveredPackIds.has(packId)) {
            pushLoaderWarning(
                warnings,
                options.onWarning,
                `requested semantic pack id not found: ${packId}`,
            );
        }
    }

    const allPacks = [...discoveredPacks, ...(options.packs || []).filter(pack => !disabledPackIds.has(pack.id))];
    assertUniquePackIds(allPacks);
    return {
        packs: allPacks,
        loadedFiles: [...loadedFiles.values()].sort((a, b) => a.localeCompare(b)),
        warnings,
    };
}

function getBuiltinPackDirs(explicitDirs?: string[]): string[] {
    const explicit = resolveExistingDirectories(explicitDirs);
    if (explicit.length > 0) {
        return explicit;
    }

    const preferredSourceDir = path.resolve(__dirname, "../../../../src/packs");
    if (fs.existsSync(preferredSourceDir) && fs.statSync(preferredSourceDir).isDirectory()) {
        return [preferredSourceDir];
    }

    return [];
}

function collectPackFiles(rootDir: string): string[] {
    return filterTypeScriptSourceFilesByMarkers(
        collectTypeScriptSourceFiles(rootDir),
        ["defineSemanticPack"],
    );
}

function resolveLoadablePackModule(absPath: string): string | null {
    return resolveLoadableTypeScriptModule(absPath);
}

function loadPacksFromModule(
    modulePath: string,
    warnings: string[],
    onWarning?: (warning: string) => void,
): LoadedSemanticPackCandidate[] {
    return loadExtensionCandidatesFromModule<SemanticPack>({
        modulePath,
        kindLabel: "semantic pack",
        warnings,
        onWarning,
        exportAliases: ["pack"],
        isCandidate: isSemanticPack,
        getId: candidate => candidate.id,
        isEnabled: candidate => candidate.enabled !== false,
    }).map(candidate => ({
        pack: candidate.value,
        enabled: candidate.enabled,
    }));
}

function isSemanticPack(value: any): value is SemanticPack {
    return !!value
        && typeof value.id === "string"
        && value.id.trim().length > 0
        && typeof value.description === "string";
}

function assertUniquePackIds(packs: SemanticPack[]): void {
    const owners = new Set<string>();
    for (const pack of packs) {
        if (owners.has(pack.id)) {
            throw new Error(`Duplicate semantic pack id: ${pack.id}`);
        }
        owners.add(pack.id);
    }
}
