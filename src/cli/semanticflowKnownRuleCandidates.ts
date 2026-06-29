import * as fs from "fs";
import * as path from "path";
import type {
    AssetDocumentBase,
    AssetRole,
    AssetBinding,
} from "../core/assets/schema";
import {
    isTrustedAnalysisAssetStatus,
    validateAssetDocument,
} from "../core/assets/schema";
import type { NormalizedCallsiteItem } from "../core/model/callsite/callsiteContextSlices";
import {
    collectExtensionExportCandidates,
    collectTypeScriptSourceFiles,
    loadExtensionModuleExports,
} from "../core/orchestration/ExtensionLoaderUtils";
import { resolveModelSelections } from "./modelSelection";
import type { RuleLoaderOptions } from "../core/rules/RuleLoader";
import { assertValidCanonicalApiId } from "../core/api/identity";

export interface FilterKnownSemanticFlowRuleCandidatesOptions {
    modelRoots?: string[];
    enabledModels?: string[];
    disabledModels?: string[];
}

export interface FilterKnownSemanticFlowRuleCandidatesResult {
    candidates: NormalizedCallsiteItem[];
    skippedKnown: NormalizedCallsiteItem[];
}

type KnownCoverageIndex = Map<string, AssetBinding[]>;

interface KnownAssetContext {
    modelRoots: string[];
    enabledRuleProjects: string[];
    enabledModuleProjects: string[];
    enabledArkMainProjects: string[];
}

const knownFilterRoles: AssetRole[] = [
    "source",
    "sink",
    "sanitizer",
    "transfer",
    "handoff",
    "entry",
    "callback-registration",
];

export function filterKnownSemanticFlowRuleCandidates(
    candidates: NormalizedCallsiteItem[],
    options: FilterKnownSemanticFlowRuleCandidatesOptions = {},
): FilterKnownSemanticFlowRuleCandidatesResult {
    if (candidates.length === 0) {
        return { candidates: [], skippedKnown: [] };
    }

    const context = resolveKnownAssetContext(options);
    const knownAssets = loadKnownAssets(context);
    const coverageIndex = buildKnownCoverageIndex(knownAssets);

    const kept: NormalizedCallsiteItem[] = [];
    const skippedKnown: NormalizedCallsiteItem[] = [];
    for (const item of candidates) {
        const identity = resolveCandidateInvokeIdentity(item);
        if (identity && isKnownCovered(coverageIndex, identity, item)) {
            skippedKnown.push(item);
            continue;
        }
        kept.push(item);
    }
    return { candidates: kept, skippedKnown };
}

function resolveKnownAssetContext(
    options: FilterKnownSemanticFlowRuleCandidatesOptions,
): KnownAssetContext {
    const modelRoots = resolveModelRoots(options.modelRoots);
    const resolved = resolveModelSelections({
        ruleOptions: {
            autoDiscoverRuleSources: true,
            ruleCatalogPath: modelRoots[0],
            ruleCatalogPaths: modelRoots,
            enabledRulePacks: [],
            disabledRulePacks: [],
        } satisfies RuleLoaderOptions,
        modelRoots,
        enabledModels: options.enabledModels || [],
        disabledModels: options.disabledModels || [],
    });
    return {
        modelRoots,
        enabledRuleProjects: resolved.ruleOptions.enabledRulePacks || [],
        enabledModuleProjects: resolved.enabledModuleProjects,
        enabledArkMainProjects: resolved.enabledArkMainProjects,
    };
}

function resolveModelRoots(roots?: string[]): string[] {
    const explicit = (roots || [])
        .map(item => path.resolve(item))
        .filter(root => fs.existsSync(root) && fs.statSync(root).isDirectory());
    if (explicit.length > 0) {
        return [...new Set(explicit)];
    }
    const defaultRoot = path.resolve(process.cwd(), "src/models");
    return fs.existsSync(defaultRoot) && fs.statSync(defaultRoot).isDirectory()
        ? [defaultRoot]
        : [];
}

function loadKnownAssets(context: KnownAssetContext): AssetDocumentBase[] {
    const assets: AssetDocumentBase[] = [];
    for (const root of context.modelRoots) {
        assets.push(...loadJsonAssets(path.join(root, "kernel", "rules"), file => file.endsWith(".rules.json")));
        assets.push(...loadJsonAssets(path.join(root, "kernel", "arkmain"), file => file.endsWith(".json")));
        assets.push(...loadTypeScriptAssets(path.join(root, "kernel", "modules")));
        for (const projectId of context.enabledRuleProjects) {
            assets.push(...loadJsonAssets(path.join(root, "project", projectId, "rules"), file => file.endsWith(".json")));
        }
        for (const projectId of context.enabledModuleProjects) {
            assets.push(...loadJsonAssets(path.join(root, "project", projectId, "modules"), file => file.endsWith(".json")));
        }
        for (const projectId of context.enabledArkMainProjects) {
            assets.push(...loadJsonAssets(path.join(root, "project", projectId, "arkmain"), file => file.endsWith(".json")));
        }
    }
    return assets;
}

function loadJsonAssets(root: string, include: (file: string) => boolean): AssetDocumentBase[] {
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
        return [];
    }
    const files = collectFiles(root)
        .filter(file => include(file))
        .sort((a, b) => a.localeCompare(b));
    const assets: AssetDocumentBase[] = [];
    for (const file of files) {
        const asset = parseAssetJsonFile(file);
        if (asset) {
            assets.push(asset);
        }
    }
    return assets;
}

function loadTypeScriptAssets(root: string): AssetDocumentBase[] {
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
        return [];
    }
    const assets: AssetDocumentBase[] = [];
    const warnings: string[] = [];
    for (const file of collectTypeScriptSourceFiles(root)) {
        const loaded = loadExtensionModuleExports({
            modulePath: file,
            kindLabel: "asset",
            warnings,
        });
        if (loaded.loadIssue || !loaded.exports) {
            continue;
        }
        for (const candidate of collectExtensionExportCandidates(loaded.exports, ["default", "asset", "moduleAsset", "assets", "moduleAssets"])) {
            if (Array.isArray(candidate)) {
                for (const item of candidate) {
                    const asset = normalizeAssetDocument(item);
                    if (asset) assets.push(asset);
                }
                continue;
            }
            const asset = normalizeAssetDocument(candidate);
            if (asset) assets.push(asset);
        }
    }
    return assets;
}

function parseAssetJsonFile(file: string): AssetDocumentBase | undefined {
    try {
        return normalizeAssetDocument(JSON.parse(fs.readFileSync(file, "utf8")));
    } catch {
        return undefined;
    }
}

function normalizeAssetDocument(value: unknown): AssetDocumentBase | undefined {
    const validation = validateAssetDocument(value);
    if (!validation.valid) {
        return undefined;
    }
    return value as AssetDocumentBase;
}

function collectFiles(root: string): string[] {
    const out: string[] = [];
    const queue = [root];
    for (let index = 0; index < queue.length; index++) {
        const current = queue[index];
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                queue.push(full);
            } else if (entry.isFile()) {
                out.push(path.resolve(full));
            }
        }
    }
    return out;
}

function resolveCandidateInvokeIdentity(item: NormalizedCallsiteItem): string | undefined {
    return acceptedCandidateCanonicalApiId(item);
}

function acceptedCandidateCanonicalApiId(item: NormalizedCallsiteItem): string | undefined {
    const value = String((item as any).canonicalApiId || "").trim();
    if (!value) return undefined;
    try {
        assertValidCanonicalApiId(value);
        return value;
    } catch {
        return undefined;
    }
}

function isKnownCovered(
    coverageIndex: KnownCoverageIndex,
    canonicalApiId: string,
    item: NormalizedCallsiteItem,
): boolean {
    const bindings = coverageIndex.get(canonicalApiId) || [];
    if (bindings.length === 0) {
        return false;
    }
    const focusedRole = roleFromCandidateFocus(item);
    if (focusedRole) {
        return bindings.some(binding => binding.role === focusedRole
            && binding.confidence !== "unknown"
            && binding.completeness !== "unknown");
    }
    return knownFilterRoles.some(role => {
        return bindings.some(binding => binding.role === role
            && binding.confidence !== "unknown"
            && binding.completeness !== "unknown");
    });
}

function buildKnownCoverageIndex(assets: AssetDocumentBase[]): KnownCoverageIndex {
    const index: KnownCoverageIndex = new Map();
    for (const asset of assets) {
        if (!isTrustedAnalysisAssetStatus(asset.status)) {
            continue;
        }
        const surfaceCanonicalIds = new Map<string, string>();
        for (const surface of asset.surfaces || []) {
            if (surface.canonicalApiId) {
                surfaceCanonicalIds.set(surface.surfaceId, surface.canonicalApiId);
            }
        }
        for (const binding of asset.bindings || []) {
            const canonicalApiId = binding.canonicalApiId || surfaceCanonicalIds.get(binding.surfaceId);
            if (!canonicalApiId || canonicalApiId !== surfaceCanonicalIds.get(binding.surfaceId)) {
                continue;
            }
            const current = index.get(canonicalApiId) || [];
            current.push(binding);
            index.set(canonicalApiId, current);
        }
    }
    return index;
}

function roleFromCandidateFocus(item: NormalizedCallsiteItem): AssetRole | undefined {
    const focus = String((item as any).semanticFocus || "").trim();
    if (focus === "returned_value_surface" || focus === "external_response_source") {
        return "source";
    }
    const explicit = String((item as any).candidatePurpose || "").trim();
    if (knownFilterRoles.includes(explicit as AssetRole)) {
        return explicit as AssetRole;
    }
    return undefined;
}
