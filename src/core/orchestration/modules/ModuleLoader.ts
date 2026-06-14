import * as fs from "fs";
import * as path from "path";
import type { AnalysisAssetLoadMode, AssetDocumentBase } from "../../assets/schema";
import type { ModuleSession, TaintModule } from "../../kernel/contracts/ModuleContract";
import type { InternalModuleLoweringIR } from "../../kernel/contracts/InternalModuleLoweringIR";
import {
    collectExtensionExportCandidates,
    auditExtensionDirectoryFiles,
    collectTypeScriptImportRecords,
    collectTypeScriptSourceFiles,
    ExtensionModuleLoadIssue,
    getExtensionSourceModulePath,
    loadExtensionModuleExports,
    pushLoaderWarning,
    loadExtensionCandidatesFromModule,
    resolveExistingDirectories,
    resolveLoadableTypeScriptModule,
    resolvePublicModuleApiPath,
} from "../ExtensionLoaderUtils";
import { isModuleAsset, lowerModuleAssetToInternalModuleLoweringIR } from "../../kernel/contracts/ModuleAssetLowering";
import { compileInternalModuleLoweringIR } from "./InternalModuleLoweringIRCompiler";

export interface ModuleLoaderOptions {
    includeBuiltinModules?: boolean;
    disabledModuleIds?: string[];
    builtinModuleRoots?: string[];
    moduleRoots?: string[];
    moduleFiles?: string[];
    modules?: TaintModule[];
    enabledModuleProjects?: string[];
    disabledModuleProjects?: string[];
    semanticflowEvaluationModelRoots?: string[];
    onWarning?: (warning: string) => void;
}

export interface ModuleLoadResult {
    modules: TaintModule[];
    loadedFiles: string[];
    warnings: string[];
    loadIssues: ExtensionModuleLoadIssue[];
    discoveredModuleProjects: string[];
    enabledModuleProjects: string[];
}

export interface ModuleCatalogEntry {
    id: string;
    description: string;
    source: ModuleSelectionSource;
    sourcePath?: string;
    projectId?: string;
    enabledByFile: boolean;
    effectiveStatus: "active" | "disabled_by_file" | "disabled_by_cli" | "project_not_enabled" | "overridden";
}

export interface ModuleInspectResult {
    catalog: ModuleCatalogEntry[];
    warnings: string[];
    loadIssues: ExtensionModuleLoadIssue[];
    discoveredModuleProjects: string[];
    enabledModuleProjects: string[];
}

interface LoadedModuleCandidate {
    module: TaintModule;
    enabled: boolean;
}

interface LoadedModuleResult {
    candidates: LoadedModuleCandidate[];
    loadIssue?: ExtensionModuleLoadIssue;
}

interface ProjectModuleAssetPack {
    projectId: string;
    rootDir: string;
    moduleFiles: string[];
    assetFiles: string[];
}

type ModuleSelectionSource = "builtin_kernel" | "project_module" | "explicit_file" | "explicit_object";

const PUBLIC_PROJECT_MODULE_API_FILES = new Set<string>([
    resolvePublicModuleApiPath(),
]);

interface SelectedModule {
    module: TaintModule;
    source: ModuleSelectionSource;
}

export function loadModules(options: ModuleLoaderOptions = {}): ModuleLoadResult {
    const warnings: string[] = [];
    const attemptedModules = new Set<string>();
    const loadedFiles = new Set<string>();
    const loadIssues: ExtensionModuleLoadIssue[] = [];
    const selectedModules = new Map<string, SelectedModule>();
    const disabledModuleIds = new Set(options.disabledModuleIds || []);
    const discoveredModuleProjects = new Set<string>();
    const enabledModuleProjects = resolveEnabledModuleProjects(options);
    const evaluationRoots = normalizeRootList(options.semanticflowEvaluationModelRoots);

    const builtinRoots = options.includeBuiltinModules === false
        ? []
        : getBuiltinModuleRoots(options.builtinModuleRoots);
    const extraRoots = resolveExistingDirectories(options.moduleRoots);
    const allRoots = [...new Set([...builtinRoots, ...extraRoots, ...evaluationRoots])];

    for (const kernelModuleRoot of collectKernelModuleRoots(allRoots)) {
        auditExtensionDirectoryFiles(kernelModuleRoot, "module", warnings, options.onWarning);
        for (const file of collectModuleFiles(kernelModuleRoot)) {
            loadModuleFile(
                file,
                "builtin_kernel",
                {
                    attemptedModules,
                    loadedFiles,
                    loadIssues,
                    selectedModules,
                    warnings,
                    disabledModuleIds,
                    onWarning: options.onWarning,
                },
            );
        }
    }

    const projectModulePacks = collectProjectModulePacks(allRoots);
    for (const pack of projectModulePacks) {
        discoveredModuleProjects.add(pack.projectId);
        if (!enabledModuleProjects.has(pack.projectId)) {
            continue;
        }
        for (const file of pack.moduleFiles) {
            loadModuleFile(
                file,
                "project_module",
                {
                    attemptedModules,
                    loadedFiles,
                    loadIssues,
                    selectedModules,
                    warnings,
                    disabledModuleIds,
                    onWarning: options.onWarning,
                    projectRootDir: pack.rootDir,
                },
            );
        }
        for (const file of pack.assetFiles) {
            const module = loadModuleAssetFile(
                file,
                warnings,
                options.onWarning,
                resolveAssetLoadMode(file, evaluationRoots),
                loadIssues,
            );
            if (!module) continue;
            loadedFiles.add(path.resolve(file));
            if (disabledModuleIds.has(module.id)) continue;
            registerModule(selectedModules, module, "project_module", warnings, options.onWarning);
        }
    }

    for (const requestedProjectId of enabledModuleProjects) {
        if (!discoveredModuleProjects.has(requestedProjectId)) {
            pushLoaderWarning(
                warnings,
                options.onWarning,
                `requested module project not found: ${requestedProjectId}`,
            );
        }
    }

    for (const file of options.moduleFiles || []) {
        loadModuleFile(
            path.resolve(file),
            "explicit_file",
            {
                attemptedModules,
                loadedFiles,
                loadIssues,
                selectedModules,
                warnings,
                disabledModuleIds,
                onWarning: options.onWarning,
            },
        );
    }

    for (const module of options.modules || []) {
        if (!module?.id) continue;
        if (disabledModuleIds.has(module.id)) continue;
        registerModule(selectedModules, module, "explicit_object", warnings, options.onWarning);
    }

    return {
        modules: [...selectedModules.values()].map(item => item.module),
        loadedFiles: [...loadedFiles.values()].sort((a, b) => a.localeCompare(b)),
        warnings,
        loadIssues,
        discoveredModuleProjects: [...discoveredModuleProjects.values()].sort((a, b) => a.localeCompare(b)),
        enabledModuleProjects: [...enabledModuleProjects.values()].sort((a, b) => a.localeCompare(b)),
    };
}

export function inspectModules(options: ModuleLoaderOptions = {}): ModuleInspectResult {
    const warnings: string[] = [];
    const attemptedModules = new Set<string>();
    const loadIssues: ExtensionModuleLoadIssue[] = [];
    const catalog: Array<ModuleCatalogEntry & { order: number }> = [];
    const disabledModuleIds = new Set(options.disabledModuleIds || []);
    const discoveredModuleProjects = new Set<string>();
    const enabledModuleProjects = resolveEnabledModuleProjects(options);
    const evaluationRoots = normalizeRootList(options.semanticflowEvaluationModelRoots);

    const builtinRoots = options.includeBuiltinModules === false
        ? []
        : getBuiltinModuleRoots(options.builtinModuleRoots);
    const extraRoots = resolveExistingDirectories(options.moduleRoots);
    const allRoots = [...new Set([...builtinRoots, ...extraRoots, ...evaluationRoots])];
    let order = 0;

    const pushCandidate = (
        module: TaintModule,
        enabledByFile: boolean,
        source: ModuleSelectionSource,
        projectId?: string,
    ): void => {
        catalog.push({
            order: order++,
            id: module.id,
            description: module.description,
            source,
            sourcePath: getExtensionSourceModulePath(module),
            projectId,
            enabledByFile,
            effectiveStatus: "active",
        });
    };

    const inspectFile = (
        file: string,
        source: ModuleSelectionSource,
        projectId?: string,
        projectRootDir?: string,
    ): void => {
        const importAuditRoot = resolveModuleImportAuditRoot(source, file, projectRootDir);
        if (importAuditRoot) {
            const auditIssue = auditProjectModuleImports(file, importAuditRoot, warnings, options.onWarning);
            if (auditIssue) {
                loadIssues.push(auditIssue);
                return;
            }
        }
        const modulePath = resolveLoadableModule(file);
        if (!modulePath) {
            pushLoaderWarning(warnings, options.onWarning, `module file not loadable: ${file}`);
            return;
        }
        if (attemptedModules.has(modulePath)) return;
        attemptedModules.add(modulePath);
        const loaded = loadModulesFromModule(modulePath, warnings, options.onWarning);
        if (loaded.loadIssue) {
            loadIssues.push(loaded.loadIssue);
        }
        for (const candidate of loaded.candidates) {
            pushCandidate(candidate.module, candidate.enabled, source, projectId);
        }
    };

    for (const kernelModuleRoot of collectKernelModuleRoots(allRoots)) {
        auditExtensionDirectoryFiles(kernelModuleRoot, "module", warnings, options.onWarning);
        for (const file of collectModuleFiles(kernelModuleRoot)) {
            inspectFile(file, "builtin_kernel");
        }
    }

    const projectModulePacks = collectProjectModulePacks(allRoots);
    for (const pack of projectModulePacks) {
        discoveredModuleProjects.add(pack.projectId);
        for (const file of pack.moduleFiles) {
            inspectFile(file, "project_module", pack.projectId, pack.rootDir);
        }
        for (const file of pack.assetFiles) {
            const module = loadModuleAssetFile(
                file,
                warnings,
                options.onWarning,
                resolveAssetLoadMode(file, evaluationRoots),
                loadIssues,
            );
            if (!module) continue;
            pushCandidate(module, module.enabled !== false, "project_module", pack.projectId);
        }
    }

    for (const file of options.moduleFiles || []) {
        inspectFile(path.resolve(file), "explicit_file");
    }

    for (const module of options.modules || []) {
        if (!module?.id) continue;
        pushCandidate(module, module.enabled !== false, "explicit_object");
    }

    const selectedIndexById = new Map<string, number>();
    for (const [index, entry] of catalog.entries()) {
        if (!entry.enabledByFile) continue;
        if (disabledModuleIds.has(entry.id)) continue;
        if (entry.source === "project_module" && entry.projectId && !enabledModuleProjects.has(entry.projectId)) continue;
        selectedIndexById.set(entry.id, index);
    }

    for (const [index, entry] of catalog.entries()) {
        if (!entry.enabledByFile) {
            entry.effectiveStatus = "disabled_by_file";
            continue;
        }
        if (disabledModuleIds.has(entry.id)) {
            entry.effectiveStatus = "disabled_by_cli";
            continue;
        }
        if (entry.source === "project_module" && entry.projectId && !enabledModuleProjects.has(entry.projectId)) {
            entry.effectiveStatus = "project_not_enabled";
            continue;
        }
        entry.effectiveStatus = selectedIndexById.get(entry.id) === index ? "active" : "overridden";
    }

    return {
        catalog: catalog
            .sort((a, b) => a.id.localeCompare(b.id) || a.order - b.order)
            .map(({ order: _order, ...entry }) => entry),
        warnings,
        loadIssues,
        discoveredModuleProjects: [...discoveredModuleProjects.values()].sort((a, b) => a.localeCompare(b)),
        enabledModuleProjects: [...enabledModuleProjects.values()].sort((a, b) => a.localeCompare(b)),
    };
}

function getBuiltinModuleRoots(explicitRoots?: string[]): string[] {
    const explicit = resolveExistingDirectories(explicitRoots);
    if (explicit.length > 0) {
        return explicit;
    }
    const preferredSourceRoot = path.resolve(__dirname, "../../../../src/models");
    if (fs.existsSync(preferredSourceRoot) && fs.statSync(preferredSourceRoot).isDirectory()) {
        return [preferredSourceRoot];
    }
    return [];
}

function collectKernelModuleRoots(moduleRoots: string[]): string[] {
    const out = new Set<string>();
    for (const root of moduleRoots) {
        const kernelModuleRoot = path.join(root, "kernel", "modules");
        if (!fs.existsSync(kernelModuleRoot) || !fs.statSync(kernelModuleRoot).isDirectory()) {
            continue;
        }
        if (collectModuleFiles(kernelModuleRoot).length === 0) {
            continue;
        }
        out.add(path.resolve(kernelModuleRoot));
    }
    return [...out.values()].sort((a, b) => a.localeCompare(b));
}

function collectModuleFiles(rootDir: string): string[] {
    return collectTypeScriptSourceFiles(rootDir)
        .sort((a, b) => a.localeCompare(b));
}

function collectProjectModulePacks(moduleRoots: string[]): ProjectModuleAssetPack[] {
    const byProjectId = new Map<string, { rootDir: string; moduleFiles: string[]; assetFiles: string[] }>();
    for (const root of moduleRoots) {
        const projectRoot = path.join(root, "project");
        if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) continue;
        for (const entry of fs.readdirSync(projectRoot, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const projectId = entry.name;
            const packRootDir = path.join(projectRoot, projectId);
            const projectDir = path.join(packRootDir, "modules");
            if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
                continue;
            }
            const moduleFiles = collectModuleFiles(projectDir);
            const assetFiles = collectProjectModuleAssetFiles(projectDir);
            if (moduleFiles.length === 0 && assetFiles.length === 0) continue;
            const current = byProjectId.get(projectId);
            if (!current) {
                byProjectId.set(projectId, {
                    rootDir: projectDir,
                    moduleFiles: [...moduleFiles],
                    assetFiles: [...assetFiles],
                });
                continue;
            }
            current.moduleFiles.push(...moduleFiles);
            current.assetFiles.push(...assetFiles);
        }
    }
    return [...byProjectId.entries()]
        .map(([projectId, spec]) => ({
            projectId,
            rootDir: spec.rootDir,
            moduleFiles: [...new Set(spec.moduleFiles)].sort((a, b) => a.localeCompare(b)),
            assetFiles: [...new Set(spec.assetFiles)].sort((a, b) => a.localeCompare(b)),
        }))
        .sort((a, b) => a.projectId.localeCompare(b.projectId));
}

function collectProjectModuleAssetFiles(rootDir: string): string[] {
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

function resolveEnabledModuleProjects(options: ModuleLoaderOptions): Set<string> {
    const requested = new Set<string>((options.enabledModuleProjects || []).map(item => item.trim()).filter(Boolean));
    const disabled = new Set<string>((options.disabledModuleProjects || []).map(item => item.trim()).filter(Boolean));
    for (const projectId of disabled) {
        requested.delete(projectId);
    }
    return requested;
}

function loadModuleFile(
    file: string,
    source: ModuleSelectionSource,
    ctx: {
        attemptedModules: Set<string>;
        loadedFiles: Set<string>;
        loadIssues: ExtensionModuleLoadIssue[];
        selectedModules: Map<string, SelectedModule>;
        warnings: string[];
        disabledModuleIds: Set<string>;
        onWarning?: (warning: string) => void;
        projectRootDir?: string;
    },
): void {
    const importAuditRoot = resolveModuleImportAuditRoot(source, file, ctx.projectRootDir);
    if (importAuditRoot) {
        const auditIssue = auditProjectModuleImports(file, importAuditRoot, ctx.warnings, ctx.onWarning);
        if (auditIssue) {
            ctx.loadIssues.push(auditIssue);
            return;
        }
    }
    const modulePath = resolveLoadableModule(file);
    if (!modulePath) {
        pushLoaderWarning(ctx.warnings, ctx.onWarning, `module file not loadable: ${file}`);
        return;
    }
    if (ctx.attemptedModules.has(modulePath)) return;
    ctx.attemptedModules.add(modulePath);
    const loaded = loadModulesFromModule(modulePath, ctx.warnings, ctx.onWarning);
    if (loaded.loadIssue) {
        ctx.loadIssues.push(loaded.loadIssue);
    }
    if (!loaded.loadIssue && loaded.candidates.length === 0) {
        pushLoaderWarning(
            ctx.warnings,
            ctx.onWarning,
            `module TypeScript file exported no loadable modules: ${modulePath}`,
        );
    }
    if (loaded.candidates.length > 0) {
        ctx.loadedFiles.add(modulePath);
    }
    for (const candidate of loaded.candidates) {
        const module = candidate.module;
        if (!candidate.enabled) continue;
        if (ctx.disabledModuleIds.has(module.id)) continue;
        registerModule(ctx.selectedModules, module, source, ctx.warnings, ctx.onWarning);
    }
}

function resolveLoadableModule(absPath: string): string | null {
    return resolveLoadableTypeScriptModule(absPath);
}

function loadModulesFromModule(
    modulePath: string,
    warnings: string[],
    onWarning?: (warning: string) => void,
): LoadedModuleResult {
    const runtimeResult = loadExtensionCandidatesFromModule<TaintModule>({
        modulePath,
        kindLabel: "module",
        warnings,
        onWarning,
        exportAliases: ["module", "modules"],
        isCandidate: isModule,
        getId: module => module.id,
        isEnabled: module => module.enabled !== false,
    });
    const byId = new Map<string, LoadedModuleCandidate>();
    for (const candidate of runtimeResult.candidates) {
        byId.set(candidate.value.id, {
            module: candidate.value,
            enabled: candidate.enabled,
        });
    }
    if (runtimeResult.loadIssue) {
        return {
            candidates: [],
            loadIssue: runtimeResult.loadIssue,
        };
    }
    const exportsResult = loadExtensionModuleExports({
        modulePath,
        kindLabel: "module",
        warnings,
        onWarning,
    });
    if (exportsResult.loadIssue) {
        return {
            candidates: [],
            loadIssue: exportsResult.loadIssue,
        };
    }
    const exportCandidates = collectExtensionExportCandidates(exportsResult.exports, ["module", "moduleAsset", "modules"]);
    const exportedAssets = collectExportedModuleAssets(exportCandidates, modulePath, warnings, onWarning);
    if (exportedAssets.length > 0) {
        const bundled = exportedAssets.map(asset => bundleModuleAsset(asset, modulePath));
        for (const module of bundled) {
            if (byId.has(module.id)) {
                pushLoaderWarning(
                    warnings,
                    onWarning,
                    `module asset export overrides duplicate runtime module id ${module.id}; keeping first export: ${modulePath}`,
                );
                continue;
            }
            byId.set(module.id, {
                module,
                enabled: module.enabled !== false,
            });
        }
    }
    return {
        candidates: [...byId.values()],
    };
}

function isModule(value: any): value is TaintModule {
    return !!value
        && typeof value.id === "string"
        && value.id.trim().length > 0
        && typeof value.description === "string"
        && !isModuleAsset(value);
}

function collectExportedModuleAssets(
    exportCandidates: any[],
    modulePath: string,
    warnings: string[],
    onWarning?: (warning: string) => void,
): AssetDocumentBase[] {
    const byId = new Map<string, AssetDocumentBase>();
    const acceptAsset = (asset: AssetDocumentBase): void => {
        if (byId.has(asset.id)) {
            pushLoaderWarning(
                warnings,
                onWarning,
                `module asset export duplicate id ${asset.id}; keeping first export: ${modulePath}`,
            );
            return;
        }
        byId.set(asset.id, asset);
    };
    for (const candidate of exportCandidates) {
        if (isModuleAsset(candidate)) {
            acceptAsset(candidate);
            continue;
        }
        if (Array.isArray(candidate)) {
            for (const item of candidate) {
                if (isModuleAsset(item)) {
                    acceptAsset(item);
                }
            }
        }
    }
    return [...byId.values()];
}

function bundleInternalModuleLoweringIR(spec: InternalModuleLoweringIR, modulePath: string): TaintModule {
    const compiledChildren = compileInternalModuleLoweringIR(spec);
    const bundled: TaintModule = {
        id: spec.id,
        description: spec.description || spec.id,
        enabled: spec.enabled,
        setup(ctx) {
            const childSessions: ModuleSession[] = [];
            for (const module of compiledChildren) {
                const session = module.setup?.(ctx);
                if (session) {
                    childSessions.push(session);
                }
            }
            if (childSessions.length === 0) {
                return;
            }
            return {
                onFact(event) {
                    const out = [];
                    for (const session of childSessions) {
                        const emitted = session.onFact?.(event);
                        if (emitted && emitted.length > 0) {
                            out.push(...emitted);
                        }
                    }
                    return out;
                },
                onInvoke(event) {
                    const out = [];
                    for (const session of childSessions) {
                        const emitted = session.onInvoke?.(event);
                        if (emitted && emitted.length > 0) {
                            out.push(...emitted);
                        }
                    }
                    return out;
                },
                shouldSkipCopyEdge(event) {
                    for (const session of childSessions) {
                        if (session.shouldSkipCopyEdge?.(event)) {
                            return true;
                        }
                    }
                    return false;
                },
            };
        },
    };
    attachInternalModuleLoweringIRSourceMeta([bundled], modulePath);
    return bundled;
}

function bundleModuleAsset(
    asset: AssetDocumentBase,
    modulePath: string,
    loadMode: AnalysisAssetLoadMode = "trusted-analysis",
): TaintModule {
    return bundleInternalModuleLoweringIR(
        lowerModuleAssetToInternalModuleLoweringIR(asset, { loadMode }),
        modulePath,
    );
}

function loadModuleAssetFile(
    file: string,
    warnings: string[],
    onWarning?: (warning: string) => void,
    loadMode: AnalysisAssetLoadMode = "trusted-analysis",
    loadIssues?: ExtensionModuleLoadIssue[],
): TaintModule | undefined {
    const modulePath = path.resolve(file);
    if (!fs.existsSync(modulePath) || !fs.statSync(modulePath).isFile()) {
        const message = `module asset file not found: ${modulePath}`;
        pushLoaderWarning(warnings, onWarning, message);
        loadIssues?.push(makeModuleAssetLoadIssue(modulePath, message, "MODULE_ASSET_FILE_NOT_FOUND"));
        return undefined;
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(modulePath, "utf-8"));
        if (!isModuleAsset(parsed)) {
            const message = `module asset file is not a v2 module asset: ${modulePath}`;
            pushLoaderWarning(warnings, onWarning, message);
            loadIssues?.push(makeModuleAssetLoadIssue(modulePath, message, "MODULE_ASSET_INVALID_SHAPE"));
            return undefined;
        }
        return bundleModuleAsset(parsed, modulePath, loadMode);
    } catch (error) {
        const message = String((error as any)?.message || error);
        pushLoaderWarning(warnings, onWarning, `failed to load module asset file ${modulePath}: ${message}`);
        loadIssues?.push(makeModuleAssetLoadIssue(
            modulePath,
            message,
            "MODULE_ASSET_LOAD_FAILED",
        ));
        return undefined;
    }
}

function makeModuleAssetLoadIssue(
    modulePath: string,
    message: string,
    code: string,
): ExtensionModuleLoadIssue {
    return {
        kindLabel: "module",
        modulePath,
        phase: "module_load",
        message,
        code,
        advice: "Inspect the declarative module asset schema, effect templates, cellKind bindings, and handle family consistency before debugging runtime emissions.",
        userMessage: `module asset load failed @ ${modulePath}: ${message}`,
    };
}

function normalizeRootList(input?: string[]): string[] {
    return [...new Set((input || [])
        .map(item => path.resolve(item))
        .filter(Boolean))];
}

function isUnderRoot(filePath: string, rootPath: string): boolean {
    const relative = path.relative(path.resolve(rootPath), path.resolve(filePath));
    return !!relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function resolveAssetLoadMode(filePath: string, evaluationRoots: readonly string[]): AnalysisAssetLoadMode {
    return evaluationRoots.some(root => isUnderRoot(filePath, root))
        ? "semanticflow-evaluation"
        : "trusted-analysis";
}

function registerModule(
    selectedModules: Map<string, SelectedModule>,
    module: TaintModule,
    source: ModuleSelectionSource,
    warnings: string[],
    onWarning?: (warning: string) => void,
): void {
    const existing = selectedModules.get(module.id);
    if (existing) {
        pushLoaderWarning(
            warnings,
            onWarning,
            `module id ${module.id} from ${describeModuleSource(source)} overrides ${describeModuleSource(existing.source)}`,
        );
    }
    selectedModules.set(module.id, { module, source });
}

function describeModuleSource(source: ModuleSelectionSource): string {
    switch (source) {
        case "builtin_kernel":
            return "kernel builtin module";
        case "project_module":
            return "project module";
        case "explicit_file":
            return "explicit module file";
        case "explicit_object":
            return "explicit module object";
    }
    return "module";
}

function resolveModuleImportAuditRoot(
    source: ModuleSelectionSource,
    filePath: string,
    projectRootDir?: string,
): string | undefined {
    if (source === "project_module") {
        return projectRootDir;
    }
    if (source === "explicit_file") {
        return path.dirname(path.resolve(filePath));
    }
    return undefined;
}

function attachInternalModuleLoweringIRSourceMeta(modules: TaintModule[], modulePath: string): void {
    const metaKey = Symbol.for("arktaint.extension_source_meta");
    for (const module of modules) {
        if (!module || (typeof module !== "object" && typeof module !== "function")) continue;
        try {
            Object.defineProperty(module as object, metaKey, {
                value: { modulePath: path.resolve(modulePath) },
                enumerable: false,
                configurable: false,
                writable: false,
            });
        } catch {
            // Best-effort only.
        }
    }
}

function auditProjectModuleImports(
    filePath: string,
    projectRootDir: string,
    warnings: string[],
    onWarning?: (warning: string) => void,
): ExtensionModuleLoadIssue | undefined {
    const normalizedFile = path.resolve(filePath);
    const normalizedProjectRoot = path.resolve(projectRootDir);
    for (const record of collectTypeScriptImportRecords(normalizedFile)) {
        const resolvedPath = record.resolvedPath ? path.resolve(record.resolvedPath) : undefined;
        if (!resolvedPath) {
            continue;
        }
        if (resolvedPath.startsWith(normalizedProjectRoot)) {
            continue;
        }
        if (PUBLIC_PROJECT_MODULE_API_FILES.has(resolvedPath)) {
            continue;
        }
        if (!resolvedPath.startsWith(process.cwd())) {
            continue;
        }
        pushLoaderWarning(
            warnings,
            onWarning,
            `project module private import rejected: ${normalizedFile}:${record.line}:${record.column} -> ${record.specifier}`,
        );
        return {
            kindLabel: "module",
            modulePath: normalizedFile,
            phase: "module_load",
            message: `project module imports private ArkTaint internals: ${record.specifier}`,
            code: "MODULE_PROJECT_PRIVATE_IMPORT",
            advice: "Project modules may only import files from the same project directory or the public @arktaint/module API. Do not depend on private core/kernel internals.",
            line: record.line,
            column: record.column,
            userMessage: `module author contract rejected private import @ ${normalizedFile}:${record.line}:${record.column}: ${record.specifier}`,
        };
    }
    return undefined;
}
