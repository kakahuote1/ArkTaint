import * as fs from "fs";
import * as path from "path";
import { normalizeEndpoint, SanitizerRule, SinkRule, SourceRule, TaintRuleSet, TransferRule } from "./RuleSchema";
import { validateRuleSet } from "./RuleValidator";
import {
    createAssetIdentityIndex,
    validateAssetDocument,
    type AnalysisAssetLoadMode,
    type AssetDocumentBase,
    type AssetIdentityIndex,
} from "../assets/schema";
import {
    createDefaultCanonicalApiRegistry,
    loadCanonicalApiRegistryFromSnapshot,
    mergeCanonicalApiRegistries,
    type CanonicalApiRegistry,
} from "../api/identity";
import { extendCanonicalApiRegistryWithAssetDeclarations } from "../assets/registry/AssetDeclaredCanonicalApiRegistry";
import { lowerRuleAssetsToRuleSet } from "./RuleAssetLowering";
import {
    RuleOrigin,
    normalizeRuleSetFamilies,
} from "./RuleFamily";

export type RuleSourceName = "kernel" | "project";

export interface RuleLoaderOptions {
    kernelRulePath?: string;
    ruleCatalogPath?: string;
    ruleCatalogPaths?: string[];
    enabledRulePacks?: string[];
    disabledRulePacks?: string[];
    projectRulePath?: string;
    candidateRulePath?: string;
    extraRulePaths?: string[];
    autoDiscoverRuleSources?: boolean;
    autoDiscoverProjectPacks?: boolean;
    allowMissingProject?: boolean;
    allowMissingCandidate?: boolean;
    semanticflowEvaluationModelRoots?: string[];
    canonicalApiRegistry?: CanonicalApiRegistry;
    canonicalApiRegistrySnapshotPath?: string;
}

export interface RuleSourceStatus {
    name: RuleSourceName;
    path: string;
    source: "explicit" | "auto";
    exists: boolean;
    applied: boolean;
    packId?: string;
    sourceRuleCount?: number;
    sinkRuleCount?: number;
    sanitizerRuleCount?: number;
    transferRuleCount?: number;
    sourceRuleIds?: string[];
    sinkRuleIds?: string[];
}

export interface LoadedRuleSet {
    ruleSet: TaintRuleSet;
    assets: AssetDocumentBase[];
    assetIdentityIndex: AssetIdentityIndex;
    canonicalApiRegistry: CanonicalApiRegistry;
    kernelRulePath?: string;
    ruleCatalogPath: string;
    enabledRulePacks: string[];
    discoveredRulePacks: string[];
    projectRulePath?: string;
    candidateRulePath?: string;
    extraRulePaths: string[];
    appliedRuleSources: RuleSourceName[];
    ruleSourceStatus: RuleSourceStatus[];
    warnings: string[];
}

export interface RulePackInspectResult {
    ruleCatalogPath: string;
    discoveredRulePacks: string[];
    enabledRulePacks: string[];
    warnings: string[];
}

export interface RuleLoadIssue {
    kind: "file_missing" | "json_parse" | "schema_assert" | "validation" | "merged_validation";
    sourceName: RuleSourceName | "extra" | "merged";
    path: string;
    message: string;
    fieldPath?: string;
    line?: number;
    column?: number;
    userMessage: string;
}

export class RuleLoadError extends Error {
    readonly issues: RuleLoadIssue[];

    constructor(message: string, issues: RuleLoadIssue[]) {
        super(message);
        this.name = "RuleLoadError";
        this.issues = issues;
    }
}

type RuleBundleKind = "sources" | "sinks" | "sanitizers" | "transfers";

interface LoadedRuleSourceEntry {
    ruleSet: TaintRuleSet;
    assets: AssetDocumentBase[];
    assetLoadModes: Map<string, AnalysisAssetLoadMode>;
    knownFiles: string[];
}

function summarizeRuleSource(ruleSet: TaintRuleSet): Pick<
    RuleSourceStatus,
    | "sourceRuleCount"
    | "sinkRuleCount"
    | "sanitizerRuleCount"
    | "transferRuleCount"
    | "sourceRuleIds"
    | "sinkRuleIds"
> {
    const sourceRules = ruleSet.sources || [];
    const sinkRules = ruleSet.sinks || [];
    return {
        sourceRuleCount: sourceRules.length,
        sinkRuleCount: sinkRules.length,
        sanitizerRuleCount: (ruleSet.sanitizers || []).length,
        transferRuleCount: (ruleSet.transfers || []).length,
        sourceRuleIds: sourceRules.map(rule => rule.id).filter(Boolean).sort((a, b) => a.localeCompare(b)),
        sinkRuleIds: sinkRules.map(rule => rule.id).filter(Boolean).sort((a, b) => a.localeCompare(b)),
    };
}

const SAFE_RULE_DIR_EXTENSIONS = new Set([".json", ".ts", ".md"]);

function extractValidationFieldPath(message: string): string | undefined {
    const normalize = (value: string | undefined): string | undefined => {
        if (!value) return undefined;
        return value.replace(/^\$\./, "").replace(/^\$/, "");
    };
    const lineMatch = message.match(/(?:^|\n)-\s*(\$?\.?[A-Za-z0-9_$.\[\]-]+)/);
    if (lineMatch?.[1]) {
        return normalize(lineMatch[1]);
    }
    const match = message.match(/^(\$?\.?[A-Za-z0-9_$.\[\]-]+)/);
    return normalize(match?.[1]);
}

interface RuleIssueLocation {
    line?: number;
    column?: number;
}

function createJsonSourceFile(absPath: string, raw: string): any | undefined {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const ts = require("typescript");
        const normalizedPath = absPath.replace(/\\/g, "/");
        return ts.createSourceFile(normalizedPath, raw, ts.ScriptTarget.ES2020, true, ts.ScriptKind.JSON);
    } catch {
        return undefined;
    }
}

function formatRuleIssueLocation(issue: Omit<RuleLoadIssue, "userMessage">): string {
    if (issue.line && issue.column) {
        return `${issue.path}:${issue.line}:${issue.column}`;
    }
    return issue.path;
}

function parseRuleFieldPath(fieldPath: string): Array<string | number> {
    const tokens: Array<string | number> = [];
    const matcher = /([^[.\]]+)|\[(\d+)\]/g;
    let match: RegExpExecArray | null;
    while ((match = matcher.exec(fieldPath)) !== null) {
        if (match[1]) {
            tokens.push(match[1]);
        } else if (match[2]) {
            tokens.push(Number(match[2]));
        }
    }
    return tokens;
}

function locateJsonNodeByFieldPath(absPath: string, raw: string, fieldPath: string): RuleIssueLocation | undefined {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const ts = require("typescript");
        const sourceFile = createJsonSourceFile(absPath, raw);
        const root = sourceFile?.statements?.[0]?.expression;
        if (!root) return undefined;

        const locationOfNode = (node: any): RuleIssueLocation | undefined => {
            if (!node) return undefined;
            const start = node.name?.getStart?.(sourceFile) ?? node.getStart?.(sourceFile);
            if (typeof start !== "number") return undefined;
            const pos = sourceFile.getLineAndCharacterOfPosition(start);
            return {
                line: pos.line + 1,
                column: pos.character + 1,
            };
        };

        let current = root;
        for (const segment of parseRuleFieldPath(fieldPath)) {
            if (typeof segment === "string") {
                if (!ts.isObjectLiteralExpression(current)) {
                    return locationOfNode(current);
                }
                const property = current.properties.find((item: any) => {
                    const nameText = item.name?.text || item.name?.getText?.(sourceFile)?.replace(/^['"]|['"]$/g, "");
                    return nameText === segment;
                });
                if (!property) {
                    return locationOfNode(current);
                }
                current = property.initializer || property;
                continue;
            }
            if (!ts.isArrayLiteralExpression(current)) {
                return locationOfNode(current);
            }
            const element = current.elements?.[segment];
            if (!element) {
                return locationOfNode(current);
            }
            current = element;
        }

        return locationOfNode(current);
    } catch {
        return undefined;
    }
}

function locateJsonSyntaxError(absPath: string, raw: string): RuleIssueLocation | undefined {
    try {
        const sourceFile = createJsonSourceFile(absPath, raw);
        if (!sourceFile) return undefined;
        const diagnostic = sourceFile.parseDiagnostics?.[0];
        if (!diagnostic || typeof diagnostic.start !== "number") {
            return undefined;
        }
        const pos = sourceFile.getLineAndCharacterOfPosition(diagnostic.start);
        return {
            line: pos.line + 1,
            column: pos.character + 1,
        };
    } catch {
        return undefined;
    }
}

function toUserRuleMessage(issue: Omit<RuleLoadIssue, "userMessage">): string {
    const location = `[${issue.sourceName}] ${formatRuleIssueLocation(issue)}`;
    switch (issue.kind) {
        case "file_missing":
            return `${location}: rule file not found`;
        case "json_parse":
            return `${location}: JSON syntax invalid: ${issue.message}`;
        case "schema_assert":
            return `${location}: rule schema invalid: ${issue.message}`;
        case "validation":
            return `${location}: rule field invalid${issue.fieldPath ? ` (${issue.fieldPath})` : ""}: ${issue.message}`;
        case "merged_validation":
            return `${location}: merged rule set invalid${issue.fieldPath ? ` (${issue.fieldPath})` : ""}: ${issue.message}`;
    }
    return `${location}: ${issue.message}`;
}

function createRuleLoadIssue(issue: Omit<RuleLoadIssue, "userMessage">): RuleLoadIssue {
    return {
        ...issue,
        userMessage: toUserRuleMessage(issue),
    };
}

function throwRuleLoadError(issue: Omit<RuleLoadIssue, "userMessage">): never {
    const full = createRuleLoadIssue(issue);
    throw new RuleLoadError(full.userMessage, [full]);
}

function auditRuleDirectories(knownRuleFiles: string[], auditRoots: string[] = []): string[] {
    const warnings: string[] = [];
    const knownFiles = new Set(knownRuleFiles.map(item => path.resolve(item)));
    const dirs = new Set<string>();
    for (const root of auditRoots) {
        if (!root) continue;
        const resolved = path.resolve(root);
        if (!fs.existsSync(resolved)) continue;
        if (fs.statSync(resolved).isDirectory()) {
            dirs.add(resolved);
        }
    }
    for (const dir of dirs) {
        if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
        const queue = [dir];
        for (let head = 0; head < queue.length; head++) {
            const current = queue[head];
            for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
                const fullPath = path.resolve(path.join(current, entry.name));
                if (entry.isDirectory()) {
                    queue.push(fullPath);
                    continue;
                }
                if (!entry.isFile()) continue;
                if (entry.name.startsWith(".")) continue;
                if (knownFiles.has(fullPath)) continue;
                const ext = path.extname(entry.name).toLowerCase();
                if (entry.name.endsWith(".rules.json")) {
                    warnings.push(`rule-like file ignored because it is not part of the active rule sources: ${fullPath}`);
                    continue;
                }
                if (SAFE_RULE_DIR_EXTENSIONS.has(ext)) {
                    continue;
                }
                warnings.push(`unexpected non-rule file ignored in model root: ${fullPath}`);
            }
        }
    }
    return warnings;
}

function readJsonFile(sourceName: RuleSourceName | "extra", absPath: string): unknown {
    const raw = fs.readFileSync(absPath, "utf-8").replace(/^\uFEFF/, "");
    try {
        return JSON.parse(raw);
    } catch (error: any) {
        const location = locateJsonSyntaxError(absPath, raw);
        throwRuleLoadError({
            kind: "json_parse",
            sourceName,
            path: absPath,
            message: String(error?.message || error),
            line: location?.line,
            column: location?.column,
        });
    }
}

function mergeById<T extends { id: string }>(base: T[], override: T[]): T[] {
    const map = new Map<string, T>();
    for (const item of base) map.set(item.id, item);
    for (const item of override) map.set(item.id, item);
    return Array.from(map.values());
}

function normalizeRules(rules: TaintRuleSet): TaintRuleSet {
    return {
        ...rules,
        sources: (rules.sources || []).filter(r => r.enabled !== false),
        sinks: (rules.sinks || []).filter(r => r.enabled !== false),
        sanitizers: (rules.sanitizers || []).filter(r => r.enabled !== false),
        transfers: (rules.transfers || []).filter(r => r.enabled !== false),
    };
}

function mergeRuleSets(base: TaintRuleSet, override: TaintRuleSet): TaintRuleSet {
    return {
        meta: { ...(base.meta || {}), ...(override.meta || {}) },
        sources: mergeById(base.sources || [], override.sources || []),
        sinks: mergeById(base.sinks || [], override.sinks || []),
        sanitizers: mergeById(base.sanitizers || [], override.sanitizers || []),
        transfers: mergeById(base.transfers || [], override.transfers || []),
    };
}

function mergeAssetsById(base: AssetDocumentBase[], override: AssetDocumentBase[]): AssetDocumentBase[] {
    return mergeById(base, override);
}

function mergeAssetLoadModes(
    base: Map<string, AnalysisAssetLoadMode>,
    override: Map<string, AnalysisAssetLoadMode>,
): Map<string, AnalysisAssetLoadMode> {
    const out = new Map(base);
    for (const [assetId, mode] of override) {
        const existing = out.get(assetId);
        if (existing && existing !== mode) {
            throw new Error(`asset ${assetId} loaded with conflicting analysis modes: ${existing} vs ${mode}`);
        }
        out.set(assetId, mode);
    }
    return out;
}

function buildAssetIdentityIndex(
    assets: AssetDocumentBase[],
    canonicalApiRegistry: CanonicalApiRegistry,
    assetLoadModes?: Map<string, AnalysisAssetLoadMode>,
): AssetIdentityIndex {
    const index = createAssetIdentityIndex({
        canonicalApiRegistry,
        assetLoadModes,
    });
    for (const asset of assets) {
        index.addAsset(asset);
    }
    const conflicts = index.listConflicts();
    if (conflicts.length > 0) {
        throw new Error(`asset identity conflicts: ${conflicts.map(item => item.message).join("; ")}`);
    }
    const unmigrated = index.listUnmigratedAssets();
    if (unmigrated.length > 0) {
        throw new Error(`asset identity incomplete: ${unmigrated.map(item => `${item.assetId}:${item.reason}`).join("; ")}`);
    }
    return index;
}

function resolveCanonicalApiRegistryForRuleLoad(options: RuleLoaderOptions): CanonicalApiRegistry {
    const registries: CanonicalApiRegistry[] = [createDefaultCanonicalApiRegistry()];
    if (options.canonicalApiRegistrySnapshotPath) {
        registries.push(loadCanonicalApiRegistryFromSnapshot(path.resolve(options.canonicalApiRegistrySnapshotPath)));
    }
    if (options.canonicalApiRegistry) {
        registries.push(options.canonicalApiRegistry);
    }
    return mergeCanonicalApiRegistries(registries);
}

export function getRuleCatalogPath(): string {
    return resolveBuiltInRuleRoot();
}

export function getCandidateRulePath(): string {
    return resolveRepoRelativePath("tmp/rules/candidate.rules.json");
}

function resolveBuiltInRuleRoot(): string {
    return resolveRepoRelativePath("src/models");
}

function resolveRepoRelativePath(repoRelativePath: string): string {
    const repoRelative = repoRelativePath.replace(/\//g, path.sep);
    const candidates = [
        path.resolve(__dirname, "../../../", repoRelative),
        path.resolve(process.cwd(), repoRelative),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return candidates[0];
}

function buildEmptyRuleSet(): TaintRuleSet {
    return {
        sources: [],
        sinks: [],
        sanitizers: [],
        transfers: [],
    };
}

function assertSingleKindRuleSet(sourceName: RuleSourceName | "extra", kind: RuleBundleKind, ruleSet: TaintRuleSet, absPath: string): void {
    const counts: Record<RuleBundleKind, number> = {
        sources: (ruleSet.sources || []).length,
        sinks: (ruleSet.sinks || []).length,
        sanitizers: (ruleSet.sanitizers || []).length,
        transfers: (ruleSet.transfers || []).length,
    };
    const offending = (Object.keys(counts) as RuleBundleKind[])
        .filter(name => name !== kind && counts[name] > 0);
    if (offending.length === 0) {
        return;
    }
        throwRuleLoadError({
            kind: "schema_assert",
            sourceName,
        path: absPath,
        message: `bundle member for ${kind} must not define ${offending.join(", ")}`,
    });
}

interface ProjectPackSpec {
    packId: string;
    files: string[];
}

const RULE_BUNDLE_KINDS: RuleBundleKind[] = ["sources", "sinks", "sanitizers", "transfers"];

function listRuleJsonFilesRecursive(dirPath: string): string[] {
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
        return [];
    }

    const files: string[] = [];
    const queue = [path.resolve(dirPath)];
    for (let head = 0; head < queue.length; head++) {
        const current = queue[head];
        const entries = fs.readdirSync(current, { withFileTypes: true })
            .sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
            const fullPath = path.resolve(path.join(current, entry.name));
            if (entry.isDirectory()) {
                queue.push(fullPath);
                continue;
            }
            if (entry.isFile() && entry.name.endsWith(".rules.json")) {
                files.push(fullPath);
            }
        }
    }
    return files.sort((a, b) => a.localeCompare(b));
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

function resolveRuleAssetLoadMode(absPath: string, evaluationRoots: readonly string[]): AnalysisAssetLoadMode {
    return evaluationRoots.some(root => isUnderRoot(absPath, root))
        ? "semanticflow-evaluation"
        : "trusted-analysis";
}

function loadAndValidateRuleAssetFile(
    sourceName: RuleSourceName | "extra",
    absPath: string,
    evaluationRoots: readonly string[] = [],
): LoadedRuleSourceEntry {
    const rawText = fs.readFileSync(absPath, "utf-8").replace(/^\uFEFF/, "");
    const raw = readJsonFile(sourceName, absPath);
    const assetValidation = validateAssetDocument(raw);
    if (!assetValidation.valid) {
        const issues = assetValidation.errors.map(message => {
            const fieldPath = extractValidationFieldPath(message);
            const location = fieldPath ? locateJsonNodeByFieldPath(absPath, rawText, fieldPath) : undefined;
            return createRuleLoadIssue({
                kind: "schema_assert",
                sourceName,
                path: absPath,
                message,
                fieldPath,
                line: location?.line,
                column: location?.column,
            });
        });
        throw new RuleLoadError(
            issues[0]?.userMessage || `Rule asset invalid (${sourceName}): ${absPath}`,
            issues,
        );
    }
    const asset = raw as AssetDocumentBase;
    const lowered = lowerRuleAssetsToRuleSet([asset], {
        loadMode: resolveRuleAssetLoadMode(absPath, evaluationRoots),
    });
    if (lowered.diagnostics.length > 0) {
        const issues = lowered.diagnostics.map(message => createRuleLoadIssue({
            kind: "schema_assert",
            sourceName,
            path: absPath,
            message,
        }));
        throw new RuleLoadError(
            issues[0]?.userMessage || `Rule asset lowering failed (${sourceName}): ${absPath}`,
            issues,
        );
    }
    const validation = validateRuleSet(lowered.ruleSet);
    if (!validation.valid) {
        const issues = validation.errors.map(message => {
            const fieldPath = extractValidationFieldPath(message);
            const location = fieldPath ? locateJsonNodeByFieldPath(absPath, rawText, fieldPath) : undefined;
            return createRuleLoadIssue({
                kind: "validation",
                sourceName,
                path: absPath,
                message,
                fieldPath,
                line: location?.line,
                column: location?.column,
            });
        });
        throw new RuleLoadError(
            issues[0]?.userMessage || `Rule set invalid (${sourceName}): ${absPath}`,
            issues,
        );
    }
    return {
        ruleSet: lowered.ruleSet,
        assets: [asset],
        assetLoadModes: new Map([[asset.id, resolveRuleAssetLoadMode(absPath, evaluationRoots)]]),
        knownFiles: [absPath],
    };
}

function loadAndValidateKindFile(
    sourceName: RuleSourceName | "extra",
    kind: RuleBundleKind,
    memberPath: string,
    evaluationRoots: readonly string[] = [],
): LoadedRuleSourceEntry {
    const loaded = loadAndValidateRuleAssetFile(sourceName, memberPath, evaluationRoots);
    assertSingleKindRuleSet(sourceName, kind, loaded.ruleSet, memberPath);
    return {
        ruleSet: loaded.ruleSet,
        assets: loaded.assets,
        assetLoadModes: loaded.assetLoadModes,
        knownFiles: loaded.knownFiles,
    };
}

function loadAndValidateRuleFiles(
    sourceName: RuleSourceName | "extra",
    files: string[],
    kind: RuleBundleKind | undefined,
    evaluationRoots: readonly string[] = [],
): LoadedRuleSourceEntry {
    let merged = buildEmptyRuleSet();
    let assets: AssetDocumentBase[] = [];
    let assetLoadModes = new Map<string, AnalysisAssetLoadMode>();
    const knownFiles: string[] = [];
    for (const file of files) {
        const loaded = kind
            ? loadAndValidateKindFile(sourceName, kind, file, evaluationRoots)
            : loadAndValidateRuleAssetFile(sourceName, file, evaluationRoots);
        merged = normalizeRules(mergeRuleSets(merged, loaded.ruleSet));
        assets = mergeAssetsById(assets, loaded.assets);
        assetLoadModes = mergeAssetLoadModes(assetLoadModes, loaded.assetLoadModes);
        for (const knownFile of loaded.knownFiles) {
            if (!knownFiles.includes(knownFile)) {
                knownFiles.push(knownFile);
            }
        }
    }
    return { ruleSet: merged, assets, assetLoadModes, knownFiles };
}

function loadAndValidateRuleSourceEntry(
    sourceName: RuleSourceName | "extra",
    absPath: string,
    evaluationRoots: readonly string[] = [],
): LoadedRuleSourceEntry {
    if (!fs.statSync(absPath).isDirectory()) {
        return loadAndValidateRuleAssetFile(sourceName, absPath, evaluationRoots);
    }

    const directRuleFiles = listRuleJsonFilesRecursive(absPath);
    const kindDirs = RULE_BUNDLE_KINDS
        .map(kind => ({ kind, dir: path.join(absPath, kind) }))
        .filter(item => fs.existsSync(item.dir) && fs.statSync(item.dir).isDirectory());

    if (kindDirs.length === 0) {
        return loadAndValidateRuleFiles(sourceName, directRuleFiles, undefined, evaluationRoots);
    }

    let merged = buildEmptyRuleSet();
    let assets: AssetDocumentBase[] = [];
    let assetLoadModes = new Map<string, AnalysisAssetLoadMode>();
    const knownFiles: string[] = [];
    for (const { kind, dir } of kindDirs) {
        const files = listRuleJsonFilesRecursive(dir);
        if (files.length === 0) {
            continue;
        }
        const member = loadAndValidateRuleFiles(sourceName, files, kind, evaluationRoots);
        merged = normalizeRules(mergeRuleSets(merged, member.ruleSet));
        assets = mergeAssetsById(assets, member.assets);
        assetLoadModes = mergeAssetLoadModes(assetLoadModes, member.assetLoadModes);
        for (const file of member.knownFiles) {
            if (!knownFiles.includes(file)) {
                knownFiles.push(file);
            }
        }
    }

    return {
        ruleSet: merged,
        assets,
        assetLoadModes,
        knownFiles,
    };
}

function normalizeKernelRuleSources(ruleSet: TaintRuleSet): TaintRuleSet {
    return ruleSet;
}

function normalizeLoadedRuleFamilies(ruleSet: TaintRuleSet, origin: RuleOrigin): TaintRuleSet {
    return normalizeRuleSetFamilies(ruleSet, origin);
}

function mergeKnownFiles(target: string[], incoming: string[]): void {
    for (const file of incoming) {
        if (!target.includes(file)) {
            target.push(file);
        }
    }
}

function collectKernelRuleRoots(modelRoots: string[]): string[] {
    const roots = new Set<string>();
    for (const modelRoot of modelRoots) {
        const rulesDir = path.join(modelRoot, "kernel", "rules");
        if (!fs.existsSync(rulesDir) || !fs.statSync(rulesDir).isDirectory()) {
            continue;
        }
        if (listRuleJsonFilesRecursive(rulesDir).length === 0) {
            continue;
        }
        roots.add(path.resolve(rulesDir));
    }
    return [...roots.values()].sort((a, b) => a.localeCompare(b));
}

function collectProjectPackSpecs(modelRoots: string[]): ProjectPackSpec[] {
    const packFiles = new Map<string, string[]>();
    for (const modelRoot of modelRoots) {
        const projectRoot = path.join(modelRoot, "project");
        if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
            continue;
        }
        const entries = fs.readdirSync(projectRoot, { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
            const packId = entry.name;
            const rulesDir = path.join(projectRoot, packId, "rules");
            if (!fs.existsSync(rulesDir) || !fs.statSync(rulesDir).isDirectory()) {
                continue;
            }
            const files = listRuleJsonFilesRecursive(rulesDir);
            if (files.length === 0) {
                continue;
            }
            const current = packFiles.get(packId) || [];
            current.push(...files);
            packFiles.set(packId, current);
        }
    }
    return [...packFiles.entries()]
        .map(([packId, files]) => ({ packId, files: [...new Set(files)].sort((a, b) => a.localeCompare(b)) }))
        .sort((a, b) => a.packId.localeCompare(b.packId));
}

function resolveEnabledProjectPacks(
    discovered: string[],
    enabled: string[] | undefined,
    disabled: string[] | undefined,
): string[] {
    const disabledSet = new Set((disabled || []).map(item => item.trim()).filter(Boolean));
    if (!enabled || enabled.length === 0) {
        return [];
    }
    const out: string[] = [];
    const requested = [...new Set(enabled.map(item => item.trim()).filter(Boolean))];
    for (const packId of requested) {
        if (disabledSet.has(packId)) {
            continue;
        }
        out.push(packId);
    }
    return out;
}

export function loadRuleSet(options: RuleLoaderOptions = {}): LoadedRuleSet {
    const warnings: string[] = [];
    const evaluationRoots = normalizeRootList(options.semanticflowEvaluationModelRoots);
    const explicitKernelRulePath = options.kernelRulePath ? path.resolve(options.kernelRulePath) : undefined;
    const explicitRuleCatalogPaths = (options.ruleCatalogPaths || [])
        .map(item => path.resolve(item))
        .filter(Boolean);
    const explicitRuleCatalogPath = options.ruleCatalogPath ? path.resolve(options.ruleCatalogPath) : undefined;
    const defaultRuleCatalogPath = getRuleCatalogPath();
    const hasExplicitRuleCatalogPath = explicitRuleCatalogPaths.length > 0 || !!explicitRuleCatalogPath;
    const shouldLoadDefaultRuleCatalog =
        options.autoDiscoverRuleSources !== false
        || (!explicitKernelRulePath && !hasExplicitRuleCatalogPath);
    const ruleCatalogRoots = [...new Set([
        ...explicitRuleCatalogPaths,
        ...(explicitRuleCatalogPath ? [explicitRuleCatalogPath] : []),
        ...(shouldLoadDefaultRuleCatalog ? [defaultRuleCatalogPath] : []),
    ])].filter(root => fs.existsSync(root));
    if (!explicitKernelRulePath && ruleCatalogRoots.length === 0) {
        throwRuleLoadError({
            kind: "file_missing",
            sourceName: "kernel",
            path: explicitRuleCatalogPath || defaultRuleCatalogPath,
            message: `model root not found: ${explicitRuleCatalogPath || defaultRuleCatalogPath}`,
        });
    }
    const ruleCatalogPath = ruleCatalogRoots[0] || explicitKernelRulePath || defaultRuleCatalogPath;

    const knownRuleFiles: string[] = [];
    let merged = buildEmptyRuleSet();
    let mergedAssets: AssetDocumentBase[] = [];
    let mergedAssetLoadModes = new Map<string, AnalysisAssetLoadMode>();
    const appliedRuleSources: RuleSourceName[] = [];
    const ruleSourceStatus: RuleSourceStatus[] = [];

    let kernelSourceApplied = false;
    if (explicitKernelRulePath) {
        if (!fs.existsSync(explicitKernelRulePath)) {
            throwRuleLoadError({
                kind: "file_missing",
                sourceName: "kernel",
                path: explicitKernelRulePath,
                message: `kernel rule file not found: ${explicitKernelRulePath}`,
            });
        }
        const explicitKernelRules = loadAndValidateRuleSourceEntry("kernel", explicitKernelRulePath, evaluationRoots);
        mergeKnownFiles(knownRuleFiles, explicitKernelRules.knownFiles);
        mergedAssets = mergeAssetsById(mergedAssets, explicitKernelRules.assets);
        mergedAssetLoadModes = mergeAssetLoadModes(mergedAssetLoadModes, explicitKernelRules.assetLoadModes);
        merged = normalizeRules(mergeRuleSets(merged, normalizeLoadedRuleFamilies(
            explicitKernelRules.ruleSet,
            { kind: "builtin_kernel_json", path: explicitKernelRulePath },
        )));
        ruleSourceStatus.push({
            name: "kernel",
            path: explicitKernelRulePath,
            source: "explicit",
            exists: true,
            applied: true,
            ...summarizeRuleSource(explicitKernelRules.ruleSet),
        });
        kernelSourceApplied = true;
    }

    const kernelKnownFiles: string[] = [];
    const kernelRuleRoots = collectKernelRuleRoots(ruleCatalogRoots);
    for (const kernelRulesDir of kernelRuleRoots) {
        const loadedKernelPack = loadAndValidateRuleSourceEntry("kernel", kernelRulesDir, evaluationRoots);
        merged = normalizeRules(mergeRuleSets(merged, loadedKernelPack.ruleSet));
        mergedAssets = mergeAssetsById(mergedAssets, loadedKernelPack.assets);
        mergedAssetLoadModes = mergeAssetLoadModes(mergedAssetLoadModes, loadedKernelPack.assetLoadModes);
        mergeKnownFiles(kernelKnownFiles, loadedKernelPack.knownFiles);
        ruleSourceStatus.push({
            name: "kernel",
            path: kernelRulesDir,
            source: "auto",
            exists: true,
            applied: true,
            ...summarizeRuleSource(loadedKernelPack.ruleSet),
        });
    }
    if (kernelKnownFiles.length === 0) {
        if (!kernelSourceApplied) {
            throwRuleLoadError({
                kind: "file_missing",
                sourceName: "kernel",
                path: ruleCatalogPath,
                message: `no kernel rule files found under ${ruleCatalogPath}`,
            });
        }
    } else {
        mergeKnownFiles(knownRuleFiles, kernelKnownFiles);
        merged = normalizeRules(normalizeLoadedRuleFamilies(
            normalizeKernelRuleSources(merged),
            { kind: "builtin_kernel_json", path: ruleCatalogPath },
        ));
        kernelSourceApplied = true;
    }
    if (kernelSourceApplied) {
        appliedRuleSources.push("kernel");
    }

    let projectPath: string | undefined;
    let candidateRulePath: string | undefined;
    const extraRulePaths: string[] = [];
    const discoveredRulePacks = collectProjectPackSpecs(ruleCatalogRoots).map(spec => spec.packId);
    const enabledRulePacks = resolveEnabledProjectPacks(
        discoveredRulePacks,
        options.enabledRulePacks,
        options.disabledRulePacks,
    );
    const enabledPackSet = new Set(enabledRulePacks);
    let projectSourceApplied = false;

    for (const requestedPack of enabledRulePacks) {
        if (!discoveredRulePacks.includes(requestedPack)) {
            throwRuleLoadError({
                kind: "file_missing",
                sourceName: "project",
                path: path.join(ruleCatalogPath, "project", requestedPack, "rules"),
                message: `project rule pack not found: ${requestedPack}`,
            });
        }
    }

    for (const spec of collectProjectPackSpecs(ruleCatalogRoots)) {
        const packRootPath = path.dirname(spec.files[0]);
        if (!enabledPackSet.has(spec.packId)) {
            ruleSourceStatus.push({
                name: "project",
                path: packRootPath,
                source: "auto",
                exists: true,
                applied: false,
                packId: spec.packId,
            });
            continue;
        }
        const rawPackRules = loadAndValidateRuleFiles("project", spec.files, undefined, evaluationRoots);
        mergeKnownFiles(knownRuleFiles, rawPackRules.knownFiles);
        mergedAssets = mergeAssetsById(mergedAssets, rawPackRules.assets);
        mergedAssetLoadModes = mergeAssetLoadModes(mergedAssetLoadModes, rawPackRules.assetLoadModes);
        const sourceRules = normalizeLoadedRuleFamilies(rawPackRules.ruleSet, {
            kind: "builtin_project_pack_json",
            path: packRootPath,
        });
        merged = normalizeRules(mergeRuleSets(merged, sourceRules));
        if (!projectSourceApplied) {
            appliedRuleSources.push("project");
            projectSourceApplied = true;
        }
        ruleSourceStatus.push({
            name: "project",
            path: packRootPath,
            source: "auto",
            exists: true,
            applied: true,
            packId: spec.packId,
            ...summarizeRuleSource(rawPackRules.ruleSet),
        });
    }

    if (options.projectRulePath) {
        projectPath = path.resolve(options.projectRulePath);
        if (!fs.existsSync(projectPath)) {
            if (options.allowMissingProject) {
                warnings.push(`project rule file not found (ignored): ${projectPath}`);
            } else {
                throwRuleLoadError({
                    kind: "file_missing",
                    sourceName: "project",
                    path: projectPath,
                    message: `project rule file not found: ${projectPath}`,
                });
            }
        } else {
            const rawProjectRules = loadAndValidateRuleSourceEntry("project", projectPath, evaluationRoots);
            mergeKnownFiles(knownRuleFiles, rawProjectRules.knownFiles);
            mergedAssets = mergeAssetsById(mergedAssets, rawProjectRules.assets);
            mergedAssetLoadModes = mergeAssetLoadModes(mergedAssetLoadModes, rawProjectRules.assetLoadModes);
            merged = normalizeRules(mergeRuleSets(merged, normalizeLoadedRuleFamilies(rawProjectRules.ruleSet, {
                kind: "external_project_json",
                path: projectPath,
            })));
            if (!projectSourceApplied) {
                appliedRuleSources.push("project");
                projectSourceApplied = true;
            }
            ruleSourceStatus.push({
                name: "project",
                path: projectPath,
                source: "explicit",
                exists: true,
                applied: true,
                ...summarizeRuleSource(rawProjectRules.ruleSet),
            });
        }
    }

    if (options.candidateRulePath) {
        candidateRulePath = path.resolve(options.candidateRulePath);
        if (!fs.existsSync(candidateRulePath)) {
            if (options.allowMissingCandidate) {
                warnings.push(`candidate rule file not found (ignored): ${candidateRulePath}`);
            } else {
                throwRuleLoadError({
                    kind: "file_missing",
                    sourceName: "project",
                    path: candidateRulePath,
                    message: `candidate rule file not found: ${candidateRulePath}`,
                });
            }
        } else {
            const rawCandidateRules = loadAndValidateRuleSourceEntry("project", candidateRulePath, evaluationRoots);
            mergeKnownFiles(knownRuleFiles, rawCandidateRules.knownFiles);
            mergedAssets = mergeAssetsById(mergedAssets, rawCandidateRules.assets);
            mergedAssetLoadModes = mergeAssetLoadModes(mergedAssetLoadModes, rawCandidateRules.assetLoadModes);
            merged = normalizeRules(mergeRuleSets(merged, normalizeLoadedRuleFamilies(rawCandidateRules.ruleSet, {
                kind: "llm_candidate_json",
                path: candidateRulePath,
            })));
            if (!projectSourceApplied) {
                appliedRuleSources.push("project");
                projectSourceApplied = true;
            }
            ruleSourceStatus.push({
                name: "project",
                path: candidateRulePath,
                source: "explicit",
                exists: true,
                applied: true,
                ...summarizeRuleSource(rawCandidateRules.ruleSet),
            });
        }
    }

    for (const extraRulePath of options.extraRulePaths || []) {
        const absPath = path.resolve(extraRulePath);
        if (!fs.existsSync(absPath)) {
            throwRuleLoadError({
                kind: "file_missing",
                sourceName: "extra",
                path: absPath,
                message: `extra rule file not found: ${absPath}`,
            });
        }
        const extraRules = loadAndValidateRuleSourceEntry("extra", absPath, evaluationRoots);
        mergeKnownFiles(knownRuleFiles, extraRules.knownFiles);
        mergedAssets = mergeAssetsById(mergedAssets, extraRules.assets);
        mergedAssetLoadModes = mergeAssetLoadModes(mergedAssetLoadModes, extraRules.assetLoadModes);
        merged = normalizeRules(mergeRuleSets(merged, normalizeLoadedRuleFamilies(extraRules.ruleSet, {
            kind: "user_project_extra_json",
            path: absPath,
        })));
        if (!projectSourceApplied) {
            appliedRuleSources.push("project");
            projectSourceApplied = true;
        }
        extraRulePaths.push(absPath);
    }

    const mergedValidation = validateRuleSet(merged);
    if (!mergedValidation.valid) {
        const issues = mergedValidation.errors.map(message => createRuleLoadIssue({
            kind: "merged_validation",
            sourceName: "merged",
            path: "<merged>",
            message,
            fieldPath: extractValidationFieldPath(message),
        }));
        throw new RuleLoadError(
            issues[0]?.userMessage || "Merged rule set invalid",
            issues,
        );
    }
    warnings.push(...mergedValidation.warnings);
    warnings.push(...auditRuleDirectories(knownRuleFiles, [
        ...ruleCatalogRoots,
        projectPath,
        candidateRulePath,
        ...extraRulePaths,
    ].filter((item): item is string => typeof item === "string" && item.trim().length > 0)));

    const canonicalApiRegistry = extendCanonicalApiRegistryWithAssetDeclarations({
        baseRegistry: resolveCanonicalApiRegistryForRuleLoad(options),
        assets: mergedAssets,
    });
    const assetIdentityIndex = buildAssetIdentityIndex(mergedAssets, canonicalApiRegistry, mergedAssetLoadModes);

    return {
        ruleSet: merged,
        assets: mergedAssets,
        assetIdentityIndex,
        canonicalApiRegistry,
        kernelRulePath: explicitKernelRulePath,
        ruleCatalogPath,
        enabledRulePacks,
        discoveredRulePacks,
        projectRulePath: projectPath,
        candidateRulePath,
        extraRulePaths,
        appliedRuleSources,
        ruleSourceStatus,
        warnings,
    };
}

export function inspectRulePacks(options: RuleLoaderOptions = {}): RulePackInspectResult {
    const warnings: string[] = [];
    const explicitRuleCatalogPaths = (options.ruleCatalogPaths || [])
        .map(item => path.resolve(item))
        .filter(Boolean);
    const explicitRuleCatalogPath = options.ruleCatalogPath ? path.resolve(options.ruleCatalogPath) : undefined;
    const defaultRuleCatalogPath = getRuleCatalogPath();
    const ruleCatalogRoots = [...new Set([
        ...explicitRuleCatalogPaths,
        ...(explicitRuleCatalogPath ? [explicitRuleCatalogPath] : []),
        defaultRuleCatalogPath,
    ])].filter(root => fs.existsSync(root));
    const ruleCatalogPath = ruleCatalogRoots[0] || explicitRuleCatalogPath || defaultRuleCatalogPath;
    if (ruleCatalogRoots.length === 0) {
        warnings.push(`rule catalog not found: ${ruleCatalogPath}`);
        return {
            ruleCatalogPath,
            discoveredRulePacks: [],
            enabledRulePacks: [],
            warnings,
        };
    }
    const discoveredRulePacks = collectProjectPackSpecs(ruleCatalogRoots).map(spec => spec.packId);
    const enabledRulePacks = resolveEnabledProjectPacks(
        discoveredRulePacks,
        options.enabledRulePacks,
        options.disabledRulePacks,
    );
    for (const requested of enabledRulePacks) {
        if (!discoveredRulePacks.includes(requested)) {
            warnings.push(`requested rule pack not found: ${requested}`);
        }
    }
    return {
        ruleCatalogPath,
        discoveredRulePacks,
        enabledRulePacks,
        warnings,
    };
}

export function tryLoadRuleSet(options: RuleLoaderOptions = {}): LoadedRuleSet | undefined {
    try {
        return loadRuleSet(options);
    } catch {
        return undefined;
    }
}

export function summarizeRuleSet(rules: TaintRuleSet): { sources: number; sinks: number; sanitizers: number; transfers: number } {
    return {
        sources: (rules.sources || []).length,
        sinks: (rules.sinks || []).length,
        sanitizers: (rules.sanitizers || []).length,
        transfers: (rules.transfers || []).length,
    };
}

export function summarizeTransferEndpoints(transfers: TransferRule[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const t of transfers) {
        const key = `${t.from}->${t.to}`;
        out[key] = (out[key] || 0) + 1;
    }
    return out;
}

export function summarizeSanitizerTargets(sanitizers: SanitizerRule[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const s of sanitizers) {
        const endpoint = s.target ? normalizeEndpoint(s.target).endpoint : "result";
        out[endpoint] = (out[endpoint] || 0) + 1;
    }
    return out;
}
