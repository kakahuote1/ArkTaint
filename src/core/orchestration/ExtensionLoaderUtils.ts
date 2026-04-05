import * as fs from "fs";
import * as path from "path";
import * as vm from "vm";

export interface LoadedExtensionCandidate<T> {
    value: T;
    enabled: boolean;
}

export interface ExtensionModuleLoadIssue {
    kindLabel: string;
    modulePath: string;
    phase: "module_load";
    message: string;
    code?: string;
    advice?: string;
    line?: number;
    column?: number;
    stackExcerpt?: string;
    userMessage: string;
}

export interface LoadExtensionCandidatesResult<T> {
    candidates: LoadedExtensionCandidate<T>[];
    loadIssue?: ExtensionModuleLoadIssue;
}

interface ExtensionSourceMeta {
    modulePath: string;
}

export interface ErrorLocation {
    path?: string;
    line?: number;
    column?: number;
    stackExcerpt?: string;
}

export interface TypeScriptImportRecord {
    specifier: string;
    line: number;
    column: number;
    resolvedPath?: string;
}

export const MODULE_API_ALIAS = "@arktaint/module";
export const PLUGIN_API_ALIAS = "@arktaint/plugin";

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

interface FreshLoadedModule {
    exports: any;
    filename: string;
    paths: string[];
    require: NodeRequire;
}

const EXTENSION_SOURCE_META = Symbol.for("arktaint.extension_source_meta");
const SAFE_IGNORED_EXTENSION_FILE_EXTENSIONS = new Set([".md", ".json", ".js", ".map", ".yaml", ".yml"]);

function classifyExtensionModuleLoadFailure(
    kindLabel: string,
    error: unknown,
): { code: string; advice: string } {
    const message = String((error as any)?.message || error);
    const lower = message.toLowerCase();
    const prefix = kindLabel === "engine plugin"
        ? "PLUGIN"
        : kindLabel === "module"
            ? "MODULE"
            : "EXTENSION";
    if (lower.includes("cannot find module")) {
        return {
            code: `${prefix}_MODULE_LOAD_MODULE_NOT_FOUND`,
            advice: "检查 import/require 路径是否写对，以及依赖文件是否存在。",
        };
    }
    if (
        (error as any)?.name === "SyntaxError"
        || lower.includes("unexpected token")
        || lower.includes("unexpected end of input")
        || lower.includes("unterminated")
        || lower.includes("missing )")
    ) {
        return {
            code: `${prefix}_MODULE_LOAD_SYNTAX_ERROR`,
            advice: "检查这个扩展文件附近是否有括号、逗号、字符串或 import 写法错误。",
        };
    }
    if (lower.includes("is not a function")) {
        return {
            code: `${prefix}_MODULE_LOAD_BAD_EXPORT`,
            advice: "检查导出的对象是否真的是合法的扩展定义，尤其是 default 导出和命名导出。",
        };
    }
    return {
        code: `${prefix}_MODULE_LOAD_UNKNOWN`,
        advice: "未能自动判断具体错因。请先核对这个扩展文件和相关 import 依赖是否能单独正常执行。",
    };
}

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
    for (let head = 0; head < queue.length; head++) {
        const current = queue[head];
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
    if (!absPath.endsWith(".ts") || absPath.endsWith(".d.ts")) return null;
    return absPath;
}

export function resolvePublicModuleApiPath(): string {
    const candidates = [
        path.resolve(process.cwd(), "src/core/kernel/contracts/ModuleApi.ts"),
        path.resolve(__dirname, "../../../src/core/kernel/contracts/ModuleApi.ts"),
        path.resolve(__dirname, "../kernel/contracts/ModuleApi.ts"),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return candidate;
        }
    }
    return path.resolve(process.cwd(), "src/core/kernel/contracts/ModuleApi.ts");
}

export function resolvePublicPluginApiPath(): string {
    const candidates = [
        path.resolve(process.cwd(), "src/core/orchestration/plugins/PluginApi.ts"),
        path.resolve(__dirname, "../../../src/core/orchestration/plugins/PluginApi.ts"),
        path.resolve(__dirname, "./plugins/PluginApi.ts"),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return candidate;
        }
    }
    return path.resolve(process.cwd(), "src/core/orchestration/plugins/PluginApi.ts");
}

export function collectTypeScriptImportRecords(filePath: string): TypeScriptImportRecord[] {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        return [];
    }
    const source = fs.readFileSync(filePath, "utf8");
    const records: TypeScriptImportRecord[] = [];
    const patterns = [
        /\b(?:import|export)\s+(?:type\s+)?[\s\S]*?\bfrom\s+["']([^"']+)["']/g,
        /\brequire\(\s*["']([^"']+)["']\s*\)/g,
    ];
    for (const pattern of patterns) {
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(source)) !== null) {
            const specifier = match[1];
            const matchIndex = match.index;
            const specifierOffset = match[0].lastIndexOf(specifier);
            const absoluteIndex = matchIndex + Math.max(specifierOffset, 0);
            records.push({
                specifier,
                line: lineNumberAt(source, absoluteIndex),
                column: columnNumberAt(source, absoluteIndex),
                resolvedPath: resolveImportTarget(filePath, specifier) || undefined,
            });
        }
    }
    return records;
}

export function auditExtensionDirectoryFiles(
    rootDir: string,
    kindLabel: string,
    warnings: string[],
    onWarning?: (warning: string) => void,
): void {
    if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
        return;
    }
    const queue = [rootDir];
    for (let head = 0; head < queue.length; head++) {
        const current = queue[head];
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const fullPath = path.resolve(path.join(current, entry.name));
            if (entry.isDirectory()) {
                queue.push(fullPath);
                continue;
            }
            if (!entry.isFile()) continue;
            if (entry.name.endsWith(".d.ts")) continue;
            if (entry.name.endsWith(".ts")) {
                const source = fs.readFileSync(fullPath, "utf8");
                const issue = detectTypeScriptSyntaxOrEncodingIssue(fullPath, source);
                if (issue) {
                    pushLoaderWarning(
                        warnings,
                        onWarning,
                        `${kindLabel} TypeScript file ignored due to syntax/encoding issue: ${fullPath} (${issue})`,
                    );
                }
                continue;
            }
            if (entry.name.startsWith(".")) continue;
            const ext = path.extname(entry.name).toLowerCase();
            if (SAFE_IGNORED_EXTENSION_FILE_EXTENSIONS.has(ext)) {
                continue;
            }
            pushLoaderWarning(
                warnings,
                onWarning,
                `${kindLabel} non-TypeScript file ignored: ${fullPath}`,
            );
        }
    }
}

export function loadExtensionCandidatesFromModule<T>(
    options: LoadExtensionModuleOptions<T>,
): LoadExtensionCandidatesResult<T> {
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
        const mod = loadFreshTypeScriptModule(modulePath);
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
            attachExtensionSourceMeta(candidate, modulePath);
            valuesById.set(id, {
                value: candidate,
                enabled: isEnabled ? isEnabled(candidate) : true,
            });
        }
        return {
            candidates: [...valuesById.values()],
        };
    } catch (error) {
        const message = String(error);
        const classification = classifyExtensionModuleLoadFailure(kindLabel, error);
        const location = extractErrorLocation(error, [modulePath]);
        pushLoaderWarning(
            warnings,
            onWarning,
            `failed to load ${kindLabel} module ${modulePath}: ${message}`,
        );
        const locationSuffix = location.path
            ? location.line && location.column
                ? ` @ ${location.path}:${location.line}:${location.column}`
                : ` @ ${location.path}`
            : "";
        return {
            candidates: [],
            loadIssue: {
                kindLabel,
                modulePath,
                phase: "module_load",
                message,
                code: classification.code,
                advice: classification.advice,
                line: location.line,
                column: location.column,
                stackExcerpt: location.stackExcerpt,
                userMessage: `${kindLabel} module load failed${locationSuffix}: ${message}`,
            },
        };
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

function resolveImportTarget(fromFile: string, specifier: string): string | null {
    if (specifier === MODULE_API_ALIAS) {
        return resolvePublicModuleApiPath();
    }
    if (specifier === PLUGIN_API_ALIAS) {
        return resolvePublicPluginApiPath();
    }
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

function lineNumberAt(source: string, absoluteIndex: number): number {
    let line = 1;
    for (let i = 0; i < absoluteIndex && i < source.length; i++) {
        if (source.charCodeAt(i) === 10) {
            line++;
        }
    }
    return line;
}

function columnNumberAt(source: string, absoluteIndex: number): number {
    let lastLineBreak = -1;
    for (let i = 0; i < absoluteIndex && i < source.length; i++) {
        if (source.charCodeAt(i) === 10) {
            lastLineBreak = i;
        }
    }
    return absoluteIndex - lastLineBreak;
}

function detectTypeScriptSyntaxOrEncodingIssue(filePath: string, source: string): string | undefined {
    if (source.includes("\u0000")) {
        return "contains NUL bytes";
    }
    if (source.includes("\uFFFD")) {
        return "contains replacement characters and may be garbled";
    }
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const ts = require("typescript");
        const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS);
        const diagnostic = sourceFile.parseDiagnostics?.[0];
        if (!diagnostic) {
            return undefined;
        }
        const text = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n").trim();
        return text || "TypeScript parser rejected the file";
    } catch {
        return undefined;
    }
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

function loadFreshTypeScriptModule(entryModulePath: string): any {
    const cache = new Map<string, FreshLoadedModule>();
    return loadFreshModuleRecursive(path.resolve(entryModulePath), cache).exports;
}

export function extractErrorLocation(error: unknown, preferredPaths: string[] = []): ErrorLocation {
    const normalizedPreferred = preferredPaths.map(item => path.resolve(item));
    const stack = typeof (error as any)?.stack === "string" ? String((error as any).stack) : "";
    if (!stack) {
        return {};
    }

    const frames = stack.split(/\r?\n/).slice(1);
    const parsed = frames
        .map(parseStackFrame)
        .filter((item): item is ErrorLocation => !!item);

    const preferred = parsed.find(frame => frame.path && normalizedPreferred.includes(path.resolve(frame.path)));
    if (preferred) {
        return refineErrorLocation(preferred);
    }
    const preferredWorkspaceFrame = parsed.find(
        frame => frame.path && frame.path.startsWith(process.cwd()) && !isArkTaintInternalLocation(frame.path),
    );
    if (preferredWorkspaceFrame) {
        return refineErrorLocation(preferredWorkspaceFrame);
    }
    const workspaceFrame = parsed.find(frame => frame.path && frame.path.startsWith(process.cwd()));
    if (workspaceFrame) {
        return refineErrorLocation(workspaceFrame);
    }
    return parsed[0] ? refineErrorLocation(parsed[0]) : {};
}

export function getExtensionSourceModulePath(value: unknown): string | undefined {
    const meta = value && (value as any)[EXTENSION_SOURCE_META] as ExtensionSourceMeta | undefined;
    return meta?.modulePath;
}

export function preferExtensionSourceLocation(
    location: ErrorLocation,
    sourcePath?: string,
): ErrorLocation {
    if (!sourcePath) return location;
    if (!location.path || isArkTaintInternalLocation(location.path)) {
        return {
            ...location,
            path: sourcePath,
            line: undefined,
            column: undefined,
        };
    }
    return location;
}

function parseStackFrame(frame: string): ErrorLocation | undefined {
    const trimmed = frame.trim();
    const parenMatch = trimmed.match(/\((.+):(\d+):(\d+)\)$/);
    const directMatch = trimmed.match(/at (.+):(\d+):(\d+)$/);
    const match = parenMatch || directMatch;
    if (!match) return undefined;
    return {
        path: match[1],
        line: Number(match[2]),
        column: Number(match[3]),
        stackExcerpt: trimmed,
    };
}

function refineErrorLocation(location: ErrorLocation): ErrorLocation {
    if (!location.path || !location.line) {
        return location;
    }
    if (!fs.existsSync(location.path) || !fs.statSync(location.path).isFile()) {
        return location;
    }
    const raw = fs.readFileSync(location.path, "utf8").replace(/\r\n/g, "\n");
    const lines = raw.split("\n");
    const lineIndex = location.line - 1;
    if (lineIndex < 0 || lineIndex >= lines.length) {
        return location;
    }
    const current = lines[lineIndex]?.trim() || "";
    if (!/^(\},?|\}\);?|\);?)$/.test(current)) {
        return location;
    }

    for (let probe = lineIndex - 1; probe >= Math.max(0, lineIndex - 3); probe--) {
        const candidate = lines[probe] || "";
        if (!/\bthrow\b/.test(candidate)) continue;
        const firstNonWs = candidate.search(/\S/);
        return {
            ...location,
            line: probe + 1,
            column: firstNonWs >= 0 ? firstNonWs + 1 : 1,
        };
    }

    return location;
}

function attachExtensionSourceMeta<T>(value: T, modulePath: string): void {
    if (!value || (typeof value !== "object" && typeof value !== "function")) return;
    try {
        Object.defineProperty(value as object, EXTENSION_SOURCE_META, {
            value: { modulePath: path.resolve(modulePath) },
            enumerable: false,
            configurable: false,
            writable: false,
        });
    } catch {
        // Best-effort metadata only.
    }
}

function isArkTaintInternalLocation(filePath: string): boolean {
    const normalized = path.resolve(filePath).replace(/\\/g, "/");
    const internalRoots = [
        path.resolve(process.cwd(), "src/core").replace(/\\/g, "/"),
        path.resolve(process.cwd(), "src/cli").replace(/\\/g, "/"),
        path.resolve(process.cwd(), "out/src/core").replace(/\\/g, "/"),
        path.resolve(process.cwd(), "out/core").replace(/\\/g, "/"),
        path.resolve(process.cwd(), "out/cli").replace(/\\/g, "/"),
    ];
    return internalRoots.some(root => normalized.startsWith(root));
}

function loadFreshModuleRecursive(
    modulePath: string,
    cache: Map<string, FreshLoadedModule>,
): FreshLoadedModule {
    const normalizedPath = path.resolve(modulePath);
    const cached = cache.get(normalizedPath);
    if (cached) {
        return cached;
    }

    const ModuleCtor = require("module") as typeof import("module");
    const loadedModule: FreshLoadedModule = {
        exports: {},
        filename: normalizedPath,
        paths: (ModuleCtor as any)._nodeModulePaths(path.dirname(normalizedPath)),
        require: undefined as unknown as NodeRequire,
    };
    cache.set(normalizedPath, loadedModule);

    const localRequire = createFreshModuleRequire(loadedModule, cache);
    loadedModule.require = localRequire;

    const wrapper = (ModuleCtor as any).wrap(transpileTypeScriptSource(normalizedPath));
    const compiled = vm.runInThisContext(wrapper, {
        filename: normalizedPath,
        displayErrors: true,
    }) as (
        exports: any,
        require: NodeRequire,
        module: FreshLoadedModule,
        __filename: string,
        __dirname: string,
    ) => void;
    compiled(
        loadedModule.exports,
        localRequire,
        loadedModule,
        normalizedPath,
        path.dirname(normalizedPath),
    );
    return loadedModule;
}

function createFreshModuleRequire(
    owner: FreshLoadedModule,
    cache: Map<string, FreshLoadedModule>,
): NodeRequire {
    const ModuleCtor = require("module") as typeof import("module");
    const localRequire = ((request: string): any => {
        const tsDependency = resolveLocalTypeScriptDependency(path.dirname(owner.filename), request);
        if (tsDependency) {
            return loadFreshModuleRecursive(tsDependency, cache).exports;
        }
        return (ModuleCtor as any).createRequire(owner.filename)(request);
    }) as NodeRequire;

    localRequire.resolve = ((request: string): string => {
        const tsDependency = resolveLocalTypeScriptDependency(path.dirname(owner.filename), request);
        if (tsDependency) {
            return tsDependency;
        }
        return (ModuleCtor as any).createRequire(owner.filename).resolve(request);
    }) as NodeRequire["resolve"];
    localRequire.cache = require.cache;
    localRequire.extensions = require.extensions;
    localRequire.main = require.main;
    return localRequire;
}

function resolveLocalTypeScriptDependency(baseDir: string, request: string): string | null {
    if (request === MODULE_API_ALIAS) {
        return resolvePublicModuleApiPath();
    }
    if (request === PLUGIN_API_ALIAS) {
        return resolvePublicPluginApiPath();
    }
    if (!request.startsWith(".") && !path.isAbsolute(request)) {
        return null;
    }
    const absBase = path.resolve(baseDir, request);
    const candidates = path.extname(absBase)
        ? [absBase]
        : [
            absBase,
            `${absBase}.ts`,
            `${absBase}.js`,
            `${absBase}.json`,
            path.join(absBase, "index.ts"),
            path.join(absBase, "index.js"),
            path.join(absBase, "index.json"),
        ];
    for (const candidate of candidates) {
        if (!fs.existsSync(candidate)) continue;
        if (!fs.statSync(candidate).isFile()) continue;
        if (candidate.endsWith(".d.ts")) return null;
        if (candidate.endsWith(".ts")) {
            return path.resolve(candidate);
        }
        return null;
    }
    return null;
}

function transpileTypeScriptSource(filename: string): string {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ts = require("typescript");
    const source = fs.readFileSync(filename, "utf8");
    return ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            moduleResolution: ts.ModuleResolutionKind.Node10,
            esModuleInterop: true,
            allowSyntheticDefaultImports: true,
        },
        fileName: filename,
        reportDiagnostics: false,
    }).outputText;
}
