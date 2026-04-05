import * as fs from "fs";
import * as path from "path";
import { TaintModule } from "../../kernel/contracts/ModuleContract";
import {
    auditExtensionDirectoryFiles,
    collectTypeScriptImportRecords,
    collectTypeScriptSourceFiles,
    ExtensionModuleLoadIssue,
    getExtensionSourceModulePath,
    loadExtensionCandidatesFromModule,
    pushLoaderWarning,
    resolveExistingDirectories,
    resolveLoadableTypeScriptModule,
    resolvePublicModuleApiPath,
} from "../ExtensionLoaderUtils";

export interface ModuleLoaderOptions {
    includeBuiltinModules?: boolean;
    disabledModuleIds?: string[];
    builtinModuleRoots?: string[];
    moduleRoots?: string[];
    moduleFiles?: string[];
    modules?: TaintModule[];
    enabledModuleProjects?: string[];
    disabledModuleProjects?: string[];
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

interface ProjectModuleSpec {
    projectId: string;
    rootDir: string;
    files: string[];
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

    const builtinRoots = options.includeBuiltinModules === false
        ? []
        : getBuiltinModuleRoots(options.builtinModuleRoots);
    const extraRoots = resolveExistingDirectories(options.moduleRoots);
    const allRoots = [...new Set([...builtinRoots, ...extraRoots])];

    for (const root of allRoots) {
        const kernelRoot = path.join(root, "kernel");
        if (fs.existsSync(kernelRoot) && fs.statSync(kernelRoot).isDirectory()) {
            auditExtensionDirectoryFiles(kernelRoot, "module", warnings, options.onWarning);
            for (const file of collectModuleFiles(kernelRoot)) {
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
    }

    const projectModuleSpecs = collectProjectModuleSpecs(allRoots);
    for (const spec of projectModuleSpecs) {
        discoveredModuleProjects.add(spec.projectId);
        if (!enabledModuleProjects.has(spec.projectId)) {
            continue;
        }
        for (const file of spec.files) {
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
                    projectRootDir: spec.rootDir,
                },
            );
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

    const builtinRoots = options.includeBuiltinModules === false
        ? []
        : getBuiltinModuleRoots(options.builtinModuleRoots);
    const extraRoots = resolveExistingDirectories(options.moduleRoots);
    const allRoots = [...new Set([...builtinRoots, ...extraRoots])];
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

    for (const root of allRoots) {
        const kernelRoot = path.join(root, "kernel");
        if (fs.existsSync(kernelRoot) && fs.statSync(kernelRoot).isDirectory()) {
            auditExtensionDirectoryFiles(kernelRoot, "module", warnings, options.onWarning);
            for (const file of collectModuleFiles(kernelRoot)) {
                inspectFile(file, "builtin_kernel");
            }
        }
    }

    const projectModuleSpecs = collectProjectModuleSpecs(allRoots);
    for (const spec of projectModuleSpecs) {
        discoveredModuleProjects.add(spec.projectId);
        for (const file of spec.files) {
            inspectFile(file, "project_module", spec.projectId, spec.rootDir);
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
    const preferredSourceRoot = path.resolve(__dirname, "../../../../src/modules");
    if (fs.existsSync(preferredSourceRoot) && fs.statSync(preferredSourceRoot).isDirectory()) {
        return [preferredSourceRoot];
    }
    return [];
}

function collectModuleFiles(rootDir: string): string[] {
    return collectTypeScriptSourceFiles(rootDir)
        .sort((a, b) => a.localeCompare(b));
}

function collectProjectModuleSpecs(moduleRoots: string[]): ProjectModuleSpec[] {
    const byProjectId = new Map<string, { rootDir: string; files: string[] }>();
    for (const root of moduleRoots) {
        const projectRoot = path.join(root, "project");
        if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) continue;
        for (const entry of fs.readdirSync(projectRoot, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const projectId = entry.name;
            const projectDir = path.join(projectRoot, projectId);
            const files = collectModuleFiles(projectDir);
            if (files.length === 0) continue;
            const current = byProjectId.get(projectId);
            if (!current) {
                byProjectId.set(projectId, { rootDir: projectDir, files: [...files] });
                continue;
            }
            current.files.push(...files);
        }
    }
    return [...byProjectId.entries()]
        .map(([projectId, spec]) => ({
            projectId,
            rootDir: spec.rootDir,
            files: [...new Set(spec.files)].sort((a, b) => a.localeCompare(b)),
        }))
        .sort((a, b) => a.projectId.localeCompare(b.projectId));
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
    const result = loadExtensionCandidatesFromModule<TaintModule>({
        modulePath,
        kindLabel: "module",
        warnings,
        onWarning,
        exportAliases: ["module"],
        isCandidate: isModule,
        getId: candidate => candidate.id,
        isEnabled: candidate => candidate.enabled !== false,
    });
    return {
        candidates: result.candidates.map(candidate => ({
            module: candidate.value,
            enabled: candidate.enabled,
        })),
        loadIssue: result.loadIssue,
    };
}

function isModule(value: any): value is TaintModule {
    return !!value
        && typeof value.id === "string"
        && value.id.trim().length > 0
        && typeof value.description === "string";
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
