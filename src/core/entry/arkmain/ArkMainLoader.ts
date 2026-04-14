import * as fs from "fs";
import * as path from "path";
import type { ModifierType } from "../../../../arkanalyzer/out/src/core/model/ArkBaseModel";
import type { Scene } from "../../../../arkanalyzer/out/src/Scene";
import type { ArkMethod } from "../../../../arkanalyzer/out/src/core/model/ArkMethod";
import type { ArkMainEntryFact } from "./ArkMainTypes";
import {
    ArkMainSpec,
    ArkMainSpecDocument,
    ArkMainSelector,
    validateArkMainSpecDocumentOrThrow,
    validateArkMainSpecOrThrow,
} from "./ArkMainSpec";

export interface ArkMainLoaderOptions {
    includeBuiltinArkMain?: boolean;
    arkMainRoots?: string[];
    arkMainSpecFiles?: string[];
    arkMainSpecs?: ArkMainSpec[];
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

interface ProjectArkMainSpec {
    projectId: string;
    files: string[];
}

export function loadArkMainSeeds(
    scene: Scene,
    options: ArkMainLoaderOptions = {},
): ArkMainLoadResult {
    const warnings: string[] = [];
    const loadedFiles = new Set<string>();
    const discoveredArkMainProjects = new Set<string>();
    const enabledArkMainProjects = resolveEnabledArkMainProjects(options);
    const docs: ArkMainSpecDocument[] = [];

    const roots = getArkMainRoots(options);
    if (options.includeBuiltinArkMain !== false) {
        for (const file of collectKernelArkMainSpecs(roots)) {
            docs.push(loadArkMainSpecDocumentFromFile(file, warnings, options.onWarning));
            loadedFiles.add(path.resolve(file));
        }
    }

    for (const spec of collectProjectArkMainSpecs(roots)) {
        discoveredArkMainProjects.add(spec.projectId);
        if (!enabledArkMainProjects.has(spec.projectId)) {
            continue;
        }
        for (const file of spec.files) {
            docs.push(loadArkMainSpecDocumentFromFile(file, warnings, options.onWarning));
            loadedFiles.add(path.resolve(file));
        }
    }

    for (const requested of enabledArkMainProjects) {
        if (!discoveredArkMainProjects.has(requested)) {
            pushWarning(warnings, options.onWarning, `requested arkmain project not found: ${requested}`);
        }
    }

    for (const file of options.arkMainSpecFiles || []) {
        const resolved = path.resolve(file);
        docs.push(loadArkMainSpecDocumentFromFile(resolved, warnings, options.onWarning));
        loadedFiles.add(resolved);
    }

    if (options.arkMainSpecs?.length) {
        docs.push({
            schemaVersion: 1,
            entries: options.arkMainSpecs.map((item, index) =>
                validateArkMainSpecOrThrow(item, `arkmainSpecs[${index}]`),
            ),
        });
    }

    const methods = new Map<string, ArkMethod>();
    const facts = new Map<string, ArkMainEntryFact>();
    for (const doc of docs) {
        for (const entry of doc.entries) {
            if (entry.enabled === false) {
                continue;
            }
            const matches = resolveArkMainSelector(scene, entry.selector);
            if (matches.length === 0) {
                pushWarning(
                    warnings,
                    options.onWarning,
                    `arkmain selector matched no methods: ${describeSelector(entry.selector)}`,
                );
                continue;
            }
            for (const method of matches) {
                const signature = method.getSignature?.()?.toString?.();
                if (!signature) {
                    continue;
                }
                methods.set(signature, method);
                const factKey = `${entry.entryPattern.phase}|${entry.entryPattern.kind}|${signature}`;
                if (!facts.has(factKey)) {
                    facts.set(factKey, {
                        phase: entry.entryPattern.phase,
                        kind: entry.entryPattern.kind,
                        method,
                        ownerKind: entry.entryPattern.ownerKind,
                        reason: entry.entryPattern.reason || `arkmain.spec:${entry.selector.methodName}`,
                        schedule: entry.entryPattern.schedule,
                        entryFamily: entry.entryPattern.entryFamily,
                        entryShape: entry.entryPattern.entryShape,
                        recognitionLayer: "arkmain.asset",
                    });
                }
            }
        }
    }

    return {
        methods: [...methods.values()],
        facts: [...facts.values()],
        loadedFiles: [...loadedFiles.values()].sort((a, b) => a.localeCompare(b)),
        warnings,
        discoveredArkMainProjects: [...discoveredArkMainProjects.values()].sort((a, b) => a.localeCompare(b)),
        enabledArkMainProjects: [...enabledArkMainProjects.values()].sort((a, b) => a.localeCompare(b)),
    };
}

export function inspectArkMainProjects(options: ArkMainLoaderOptions = {}): Pick<
    ArkMainLoadResult,
    "warnings" | "discoveredArkMainProjects" | "enabledArkMainProjects" | "loadedFiles"
> {
    const warnings: string[] = [];
    const roots = getArkMainRoots(options);
    const discoveredArkMainProjects = collectProjectArkMainSpecs(roots).map(spec => spec.projectId);
    const enabledArkMainProjects = [...resolveEnabledArkMainProjects(options).values()]
        .sort((a, b) => a.localeCompare(b));
    for (const requested of enabledArkMainProjects) {
        if (!discoveredArkMainProjects.includes(requested)) {
            pushWarning(warnings, options.onWarning, `requested arkmain project not found: ${requested}`);
        }
    }
    const loadedFiles = collectProjectArkMainSpecs(roots)
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

function collectKernelArkMainSpecs(roots: string[]): string[] {
    const out = new Set<string>();
    for (const root of roots) {
        const arkMainRoot = path.join(root, "kernel", "arkmain");
        if (!fs.existsSync(arkMainRoot) || !fs.statSync(arkMainRoot).isDirectory()) {
            continue;
        }
        for (const file of collectArkMainJsonFiles(arkMainRoot)) {
            out.add(path.resolve(file));
        }
    }
    return [...out.values()].sort((a, b) => a.localeCompare(b));
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

function collectProjectArkMainSpecs(roots: string[]): ProjectArkMainSpec[] {
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
            const files = collectArkMainJsonFiles(assetRoot);
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

function collectArkMainJsonFiles(rootDir: string): string[] {
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
            if (!entry.name.toLowerCase().endsWith(".arkmain.json")) {
                continue;
            }
            out.push(path.resolve(fullPath));
        }
    }
    return out.sort((a, b) => a.localeCompare(b));
}

function loadArkMainSpecDocumentFromFile(
    filePath: string,
    warnings: string[],
    onWarning?: (warning: string) => void,
): ArkMainSpecDocument {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        throw new Error(`arkmain spec file not found: ${resolved}`);
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(resolved, "utf-8"));
        return validateArkMainSpecDocumentOrThrow(parsed, resolved);
    } catch (error) {
        const message = String((error as any)?.message || error);
        pushWarning(warnings, onWarning, `failed to load arkmain spec file ${resolved}: ${message}`);
        throw new Error(`arkmain spec load failed: ${resolved}: ${message}`);
    }
}

function resolveArkMainSelector(scene: Scene, selector: ArkMainSelector): ArkMethod[] {
    const out = new Map<string, ArkMethod>();
    for (const method of scene.getMethods()) {
        if (!isEligibleArkMainMethod(method)) {
            continue;
        }
        if (!matchesArkMainSelector(method, selector)) {
            continue;
        }
        const signature = method.getSignature?.()?.toString?.();
        if (!signature || out.has(signature)) {
            continue;
        }
        out.set(signature, method);
    }
    return [...out.values()];
}

function matchesArkMainSelector(method: ArkMethod, selector: ArkMainSelector): boolean {
    if (String(method.getName?.() || "") !== selector.methodName) {
        return false;
    }
    if (!sameStringArray(parameterTypesOf(method), selector.parameterTypes)) {
        return false;
    }
    if ((selector.returnType || "") !== "") {
        if (returnTypeOf(method) !== selector.returnType) {
            return false;
        }
    }
    if (selector.requireOverride !== undefined && isOverrideMethod(method) !== selector.requireOverride) {
        return false;
    }
    const declaringClass = method.getDeclaringArkClass?.();
    const className = String(declaringClass?.getName?.() || "").trim();
    const superClassName = String(
        declaringClass?.getSuperClass?.()?.getName?.()
        || declaringClass?.getSuperClassName?.()
        || "",
    ).trim();
    if (selector.className && className !== selector.className) {
        return false;
    }
    if (selector.superClassName && superClassName !== selector.superClassName) {
        return false;
    }
    return true;
}

function isEligibleArkMainMethod(method: ArkMethod): boolean {
    if (method.isStatic?.() || method.isPrivate?.()) {
        return false;
    }
    if (method.isGenerated?.() || method.isAnonymousMethod?.()) {
        return false;
    }
    return true;
}

function isOverrideMethod(method: ArkMethod): boolean {
    return Boolean(method.containsModifier?.(8192 as ModifierType));
}

function parameterTypesOf(method: ArkMethod): string[] {
    return (method.getParameters?.() || [])
        .map((param: any) => String(param?.getType?.()?.toString?.() || "").trim())
        .filter(Boolean);
}

function returnTypeOf(method: ArkMethod): string | undefined {
    const text = String(method.getReturnType?.()?.toString?.() || "").trim();
    return text || undefined;
}

function sameStringArray(left: string[], right: string[]): boolean {
    if (left.length !== right.length) {
        return false;
    }
    for (let index = 0; index < left.length; index++) {
        if (left[index] !== right[index]) {
            return false;
        }
    }
    return true;
}

function pushWarning(warnings: string[], onWarning: ((warning: string) => void) | undefined, warning: string): void {
    warnings.push(warning);
    onWarning?.(warning);
}

function describeSelector(selector: ArkMainSelector): string {
    const owner = selector.superClassName
        ? `super=${selector.superClassName}`
        : `class=${selector.className}`;
    const params = selector.parameterTypes.join(",");
    const returnType = selector.returnType || "-";
    return `${owner} ${selector.methodName}(${params}) -> ${returnType}`;
}
