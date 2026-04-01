import * as fs from "fs";
import * as path from "path";
import { SemanticPack } from "../../kernel/contracts/SemanticPack";
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
    loadIssues: ExtensionModuleLoadIssue[];
}

interface LoadedSemanticPackCandidate {
    pack: SemanticPack;
    enabled: boolean;
}

interface LoadedSemanticPackModuleResult {
    candidates: LoadedSemanticPackCandidate[];
    loadIssue?: ExtensionModuleLoadIssue;
}

type PackSelectionSource = "builtin" | "external" | "explicit";

interface SelectedSemanticPack {
    pack: SemanticPack;
    source: PackSelectionSource;
}

export function loadSemanticPacks(options: PackLoaderOptions = {}): SemanticPackLoadResult {
    const warnings: string[] = [];
    const attemptedModules = new Set<string>();
    const loadedFiles = new Set<string>();
    const loadIssues: ExtensionModuleLoadIssue[] = [];
    const selectedPacks = new Map<string, SelectedSemanticPack>();
    const builtinPackFiles = new Set<string>();
    const externalPackFiles = new Set<string>();
    const disabledPackIds = new Set(options.disabledPackIds || []);
    const discoveredPackIds = new Set<string>();

    if (options.includeBuiltinPacks !== false) {
        for (const dir of getBuiltinPackDirs(options.builtinPackDirs)) {
            auditExtensionDirectoryFiles(dir, "semantic pack", warnings, options.onWarning);
            for (const file of collectPackFiles(dir)) {
                builtinPackFiles.add(file);
            }
        }
    }

    for (const dir of options.packDirs || []) {
        const absDir = path.resolve(dir);
        auditExtensionDirectoryFiles(absDir, "semantic pack", warnings, options.onWarning);
        for (const file of collectPackFiles(absDir)) {
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
        if (packs.loadIssue) {
            loadIssues.push(packs.loadIssue);
        }
        if (packs.candidates.length > 0) {
            loadedFiles.add(modulePath);
        }
        for (const candidate of packs.candidates) {
            const pack = candidate.pack;
            discoveredPackIds.add(pack.id);
            if (!candidate.enabled) {
                continue;
            }
            if (disabledPackIds.has(pack.id)) {
                continue;
            }
            registerSemanticPack(selectedPacks, pack, "builtin", warnings, options.onWarning);
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
        if (packs.loadIssue) {
            loadIssues.push(packs.loadIssue);
        }
        if (packs.candidates.length > 0) {
            loadedFiles.add(modulePath);
        }
        for (const candidate of packs.candidates) {
            const pack = candidate.pack;
            discoveredPackIds.add(pack.id);
            if (!candidate.enabled) {
                continue;
            }
            if (disabledPackIds.has(pack.id)) {
                continue;
            }
            registerSemanticPack(selectedPacks, pack, "external", warnings, options.onWarning);
        }
    }

    for (const pack of options.packs || []) {
        if (!pack?.id) continue;
        discoveredPackIds.add(pack.id);
        if (disabledPackIds.has(pack.id)) {
            continue;
        }
        registerSemanticPack(selectedPacks, pack, "explicit", warnings, options.onWarning);
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

    const allPacks = [...selectedPacks.values()].map(item => item.pack);
    return {
        packs: allPacks,
        loadedFiles: [...loadedFiles.values()].sort((a, b) => a.localeCompare(b)),
        warnings,
        loadIssues,
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
): LoadedSemanticPackModuleResult {
    const result = loadExtensionCandidatesFromModule<SemanticPack>({
        modulePath,
        kindLabel: "semantic pack",
        warnings,
        onWarning,
        exportAliases: ["pack"],
        isCandidate: isSemanticPack,
        getId: candidate => candidate.id,
        isEnabled: candidate => candidate.enabled !== false,
    });
    return {
        candidates: result.candidates.map(candidate => ({
            pack: candidate.value,
            enabled: candidate.enabled,
        })),
        loadIssue: result.loadIssue,
    };
}

function isSemanticPack(value: any): value is SemanticPack {
    return !!value
        && typeof value.id === "string"
        && value.id.trim().length > 0
        && typeof value.description === "string";
}

function registerSemanticPack(
    selectedPacks: Map<string, SelectedSemanticPack>,
    pack: SemanticPack,
    source: PackSelectionSource,
    warnings: string[],
    onWarning?: (warning: string) => void,
): void {
    const existing = selectedPacks.get(pack.id);
    if (existing) {
        pushLoaderWarning(
            warnings,
            onWarning,
            `semantic pack id ${pack.id} from ${describePackSource(source)} overrides ${describePackSource(existing.source)}`,
        );
    }
    selectedPacks.set(pack.id, { pack, source });
}

function describePackSource(source: PackSelectionSource): string {
    switch (source) {
        case "builtin":
            return "builtin pack";
        case "external":
            return "external pack";
        case "explicit":
            return "explicit pack object";
    }
    return "semantic pack";
}
