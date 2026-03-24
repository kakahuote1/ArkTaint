import * as fs from "fs";
import * as path from "path";

export interface LoadedExtensionCandidate<T> {
    value: T;
    enabled: boolean;
}

export interface LoadExtensionModuleOptions<T> {
    modulePath: string;
    kindLabel: string;
    warnings: string[];
    onWarning?: (warning: string) => void;
    exportAliases?: string[];
    isCandidate(value: any): value is T;
    getId(value: T): string;
    isEnabled?(value: T): boolean;
}

let tsRequireHookInstalled = false;

export function resolveExistingDirectories(dirs?: string[]): string[] {
    if (!dirs || dirs.length === 0) {
        return [];
    }
    const unique = new Set<string>();
    for (const dir of dirs) {
        const candidate = path.resolve(dir);
        if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) {
            continue;
        }
        unique.add(candidate);
    }
    return [...unique.values()];
}

export function collectTypeScriptSourceFiles(rootDir: string): string[] {
    if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
        return [];
    }
    const out: string[] = [];
    const queue = [rootDir];
    while (queue.length > 0) {
        const current = queue.shift()!;
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                queue.push(fullPath);
                continue;
            }
            if (!entry.isFile()) continue;
            if (!isLoadableTypeScriptSourceFile(entry.name)) continue;
            out.push(path.resolve(fullPath));
        }
    }
    return out.sort((a, b) => a.localeCompare(b));
}

export function filterTypeScriptSourceFilesByMarkers(files: string[], markers: string[]): string[] {
    if (markers.length === 0) {
        return [...files];
    }
    const normalizedMarkers = markers.map(marker => marker.trim()).filter(Boolean);
    return files.filter(file => {
        const source = fs.readFileSync(file, "utf8");
        return normalizedMarkers.some(marker => source.includes(marker));
    });
}

export function resolveLoadableTypeScriptModule(absPath: string): string | null {
    if (!fs.existsSync(absPath)) return null;
    if (!absPath.endsWith(".ts")) return null;
    ensureTypeScriptRequireHook();
    return absPath;
}

export function loadExtensionCandidatesFromModule<T>(
    options: LoadExtensionModuleOptions<T>,
): LoadedExtensionCandidate<T>[] {
    const {
        modulePath,
        kindLabel,
        warnings,
        onWarning,
        exportAliases,
        isCandidate,
        getId,
        isEnabled,
    } = options;
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require(modulePath);
        const candidates = collectExportCandidates(mod, exportAliases);
        const valuesById = new Map<string, LoadedExtensionCandidate<T>>();
        for (const candidate of candidates) {
            if (!isCandidate(candidate)) continue;
            const id = getId(candidate);
            if (valuesById.has(id)) {
                pushLoaderWarning(
                    warnings,
                    onWarning,
                    `${kindLabel} module exports duplicate id ${id}; keeping first export: ${modulePath}`,
                );
                continue;
            }
            valuesById.set(id, {
                value: candidate,
                enabled: isEnabled ? isEnabled(candidate) : true,
            });
        }
        return [...valuesById.values()];
    } catch (error) {
        pushLoaderWarning(
            warnings,
            onWarning,
            `failed to load ${kindLabel} module ${modulePath}: ${String(error)}`,
        );
        return [];
    }
}

export function pushLoaderWarning(
    warnings: string[],
    onWarning: ((warning: string) => void) | undefined,
    warning: string,
): void {
    warnings.push(warning);
    onWarning?.(warning);
}

function isLoadableTypeScriptSourceFile(fileName: string): boolean {
    return fileName.endsWith(".ts") && !fileName.endsWith(".d.ts");
}

function collectExportCandidates(mod: any, exportAliases?: string[]): any[] {
    const out: any[] = [];
    const aliases = exportAliases || [];
    if (!mod) return out;
    if (mod.default) out.push(mod.default);
    for (const alias of aliases) {
        if (mod[alias]) {
            out.push(mod[alias]);
        }
    }
    if (typeof mod === "object") {
        for (const value of Object.values(mod)) {
            if (value && !out.includes(value)) {
                out.push(value);
            }
        }
    } else {
        out.push(mod);
    }
    return out;
}

function ensureTypeScriptRequireHook(): void {
    if (tsRequireHookInstalled) return;
    if (typeof require.extensions[".ts"] === "function") {
        tsRequireHookInstalled = true;
        return;
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ts = require("typescript");
    require.extensions[".ts"] = (module: any, filename: string): void => {
        const source = fs.readFileSync(filename, "utf8");
        const output = ts.transpileModule(source, {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES2020,
                moduleResolution: ts.ModuleResolutionKind.Node10,
                esModuleInterop: true,
                allowSyntheticDefaultImports: true,
            },
            fileName: filename,
            reportDiagnostics: false,
        });
        module._compile(output.outputText, filename);
    };
    tsRequireHookInstalled = true;
}
