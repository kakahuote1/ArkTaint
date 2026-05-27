import * as fs from "fs";
import * as path from "path";
import type { Scene } from "../../../../arkanalyzer/out/src/Scene";
import type { ArkMethod } from "../../../../arkanalyzer/out/src/core/model/ArkMethod";
import type { ArkMainEntryFact } from "./ArkMainTypes";

export interface ArkMainLoaderOptions {
    includeBuiltinArkMain?: boolean;
    arkMainRoots?: string[];
    enabledArkMainProjects?: string[];
    disabledArkMainProjects?: string[];
    onWarning?: (warning: string) => void;
}

export interface ArkMainLoadResult {
    methods: ArkMethod[];
    facts: ArkMainEntryFact[];
    loadedFiles: string[];
    warnings: string[];
    discoveredArkMainProjects: string[];
    enabledArkMainProjects: string[];
}

interface ProjectArkMainAssetPack {
    projectId: string;
    files: string[];
}

export function loadArkMainSeeds(
    _scene: Scene,
    options: ArkMainLoaderOptions = {},
): ArkMainLoadResult {
    const warnings: string[] = [];
    const roots = getArkMainRoots(options);
    const discoveredArkMainProjects = collectProjectArkMainAssetPacks(roots).map(spec => spec.projectId);
    const enabledArkMainProjects = [...resolveEnabledArkMainProjects(options).values()]
        .sort((a, b) => a.localeCompare(b));
    for (const requested of enabledArkMainProjects) {
        if (!discoveredArkMainProjects.includes(requested)) {
            pushWarning(warnings, options.onWarning, `requested arkmain project not found: ${requested}`);
        }
    }
    return {
        methods: [],
        facts: [],
        loadedFiles: [],
        warnings,
        discoveredArkMainProjects: discoveredArkMainProjects.sort((a, b) => a.localeCompare(b)),
        enabledArkMainProjects,
    };
}

export function inspectArkMainProjects(options: ArkMainLoaderOptions = {}): Pick<
    ArkMainLoadResult,
    "warnings" | "discoveredArkMainProjects" | "enabledArkMainProjects" | "loadedFiles"
> {
    const warnings: string[] = [];
    const roots = getArkMainRoots(options);
    const discoveredPacks = collectProjectArkMainAssetPacks(roots);
    const discoveredArkMainProjects = discoveredPacks.map(spec => spec.projectId);
    const enabledArkMainProjects = [...resolveEnabledArkMainProjects(options).values()]
        .sort((a, b) => a.localeCompare(b));
    for (const requested of enabledArkMainProjects) {
        if (!discoveredArkMainProjects.includes(requested)) {
            pushWarning(warnings, options.onWarning, `requested arkmain project not found: ${requested}`);
        }
    }
    const loadedFiles = discoveredPacks
        .flatMap(spec => spec.files)
        .map(file => path.resolve(file))
        .sort((a, b) => a.localeCompare(b));
    return {
        warnings,
        discoveredArkMainProjects: discoveredArkMainProjects.sort((a, b) => a.localeCompare(b)),
        enabledArkMainProjects,
        loadedFiles,
    };
}

function getArkMainRoots(options: ArkMainLoaderOptions): string[] {
    const explicit = resolveExistingDirectories(options.arkMainRoots);
    if (explicit.length > 0) {
        return explicit;
    }
    const preferredSourceRoot = path.resolve(__dirname, "../../../../src/models");
    if (fs.existsSync(preferredSourceRoot) && fs.statSync(preferredSourceRoot).isDirectory()) {
        return [preferredSourceRoot];
    }
    return [];
}

function resolveExistingDirectories(input?: string[]): string[] {
    return [...new Set((input || [])
        .map(item => path.resolve(item))
        .filter(item => fs.existsSync(item) && fs.statSync(item).isDirectory()))];
}

function resolveEnabledArkMainProjects(options: ArkMainLoaderOptions): Set<string> {
    const disabled = new Set((options.disabledArkMainProjects || []).map(item => item.trim()).filter(Boolean));
    const enabled = new Set<string>();
    for (const projectId of options.enabledArkMainProjects || []) {
        const normalized = projectId.trim();
        if (!normalized || disabled.has(normalized)) {
            continue;
        }
        enabled.add(normalized);
    }
    return enabled;
}

function collectProjectArkMainAssetPacks(roots: string[]): ProjectArkMainAssetPack[] {
    const byProject = new Map<string, string[]>();
    for (const root of roots) {
        const projectRoot = path.join(root, "project");
        if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
            continue;
        }
        const entries = fs.readdirSync(projectRoot, { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
            const packRoot = path.join(projectRoot, entry.name);
            const assetRoot = path.join(packRoot, "arkmain");
            if (!fs.existsSync(assetRoot) || !fs.statSync(assetRoot).isDirectory()) {
                continue;
            }
            const files = collectArkMainAssetFiles(assetRoot);
            if (files.length === 0) {
                continue;
            }
            const existing = byProject.get(entry.name) || [];
            byProject.set(entry.name, [...existing, ...files]);
        }
    }
    return [...byProject.entries()]
        .map(([projectId, files]) => ({
            projectId,
            files: files.sort((a, b) => a.localeCompare(b)),
        }))
        .sort((a, b) => a.projectId.localeCompare(b.projectId));
}

function collectArkMainAssetFiles(rootDir: string): string[] {
    if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
        return [];
    }
    const out: string[] = [];
    const queue = [rootDir];
    for (let head = 0; head < queue.length; head++) {
        const current = queue[head];
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                queue.push(fullPath);
                continue;
            }
            if (!entry.isFile()) {
                continue;
            }
            if (!entry.name.toLowerCase().endsWith(".json")) {
                continue;
            }
            out.push(path.resolve(fullPath));
        }
    }
    return out.sort((a, b) => a.localeCompare(b));
}

function pushWarning(warnings: string[], onWarning: ((warning: string) => void) | undefined, warning: string): void {
    warnings.push(warning);
    onWarning?.(warning);
}
