import * as fs from "fs";
import * as path from "path";
import type {
    AssetDocumentBase,
    AssetIdentity,
    AssetRole,
    AssetSurface,
    InvokeSurface,
} from "../core/assets/schema";
import {
    createAssetSurfaceRegistry,
    resolveAssetIdentity,
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

export interface FilterKnownSemanticFlowRuleCandidatesOptions {
    modelRoots?: string[];
    enabledModels?: string[];
    disabledModels?: string[];
}

export interface FilterKnownSemanticFlowRuleCandidatesResult {
    candidates: NormalizedCallsiteItem[];
    skippedKnown: NormalizedCallsiteItem[];
}

interface KnownAssetContext {
    modelRoots: string[];
    enabledRuleProjects: string[];
    enabledModuleProjects: string[];
    enabledArkMainProjects: string[];
}

interface ParsedInvokeSignature {
    modulePath: string;
    ownerName?: string;
    functionName?: string;
    methodName?: string;
    parameterTypes: string[];
    invokeKindHint?: InvokeSurface["invokeKind"];
}

const loadableAssetStatuses = new Set(["official", "reviewed", "replayed"]);
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
    const registry = createAssetSurfaceRegistry();
    for (const asset of loadKnownAssets(context)) {
        registry.addAsset(asset);
    }

    const kept: NormalizedCallsiteItem[] = [];
    const skippedKnown: NormalizedCallsiteItem[] = [];
    for (const item of candidates) {
        if (isKnownOfficialArkMainBoundaryCandidate(item)) {
            skippedKnown.push(item);
            continue;
        }
        const identity = resolveCandidateInvokeIdentity(item);
        if (identity && isKnownCovered(registry, identity, item)) {
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
            autoDiscoverLayers: true,
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
    return assets.filter(asset => loadableAssetStatuses.has(asset.status));
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

function resolveCandidateInvokeIdentity(item: NormalizedCallsiteItem): AssetIdentity | undefined {
    const surface = resolveCandidateInvokeSurface(item);
    if (!surface) return undefined;
    const identity = resolveAssetIdentity(surface);
    return identity.status === "resolved" ? identity.identity : undefined;
}

function resolveCandidateInvokeSurface(item: NormalizedCallsiteItem): InvokeSurface | undefined {
    const parsed = parseInvokeSignature(item.callee_signature);
    if (!parsed) return undefined;
    const methodName = parsed.methodName || parsed.functionName || "";
    if (item.method && methodName && item.method !== methodName) {
        return undefined;
    }
    const invokeKind = parsed.invokeKindHint || candidateInvokeKind(item);
    if (!invokeKind) return undefined;
    const argCount = Number.isInteger(item.argCount)
        ? item.argCount
        : parsed.parameterTypes.length;
    if (!Number.isInteger(argCount) || argCount < 0) {
        return undefined;
    }
    if (parsed.parameterTypes.length > 0 && parsed.parameterTypes.length !== argCount) {
        return undefined;
    }
    return {
        surfaceId: `observed.${stableId(item.callee_signature)}.${String(item.sourceFile || "unknown")}`,
        kind: "invoke",
        modulePath: parsed.modulePath,
        ownerName: parsed.ownerName,
        functionName: parsed.functionName,
        methodName: parsed.methodName,
        invokeKind,
        argCount,
        confidence: "certain",
        provenance: {
            source: "analyzer",
            location: { file: String(item.sourceFile || "") },
            typeSignature: item.callee_signature,
        },
    };
}

function isKnownOfficialArkMainBoundaryCandidate(item: NormalizedCallsiteItem): boolean {
    const topEntries = Array.isArray(item.topEntries) ? item.topEntries : [];
    return topEntries.some(entry =>
        String(entry || "").trim() === "candidateBoundary=official_arkmain_entry_evidence");
}

function candidateInvokeKind(item: NormalizedCallsiteItem): InvokeSurface["invokeKind"] | undefined {
    if (item.invokeKind === "instance" || item.invokeKind === "static") {
        return item.invokeKind;
    }
    return undefined;
}

function isKnownCovered(
    registry: ReturnType<typeof createAssetSurfaceRegistry>,
    identity: AssetIdentity,
    item: NormalizedCallsiteItem,
): boolean {
    const focusedRole = roleFromCandidateFocus(item);
    if (focusedRole) {
        const coverage = registry.queryCoverage({
            identity,
            expectedRoles: [focusedRole],
            candidatePurpose: toCoveragePurpose(focusedRole),
        });
        return coverage.status === "covered-exact-role";
    }
    return knownFilterRoles.some(role => {
        const coverage = registry.queryCoverage({
            identity,
            expectedRoles: [role],
            candidatePurpose: toCoveragePurpose(role),
        });
        return coverage.status === "covered-exact-role"
            || registry.findBindings(identity, { roles: [role] }).some(binding =>
                binding.confidence !== "unknown" && binding.completeness !== "unknown");
    });
}

function toCoveragePurpose(role: AssetRole): "source" | "sink" | "transfer" | "handoff" | "entry" | "unknown" {
    return role === "source"
        || role === "sink"
        || role === "transfer"
        || role === "handoff"
        || role === "entry"
        ? role
        : "unknown";
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

function parseInvokeSignature(signature: unknown): ParsedInvokeSignature | undefined {
    const text = String(signature || "").trim();
    if (!text || text.includes("%unk") || text.includes("@unk/") || text.startsWith("@unk")) {
        return undefined;
    }
    const colon = text.lastIndexOf(":");
    if (colon <= 0) return undefined;
    const modulePath = stableModulePath(text.slice(0, colon));
    const body = text.slice(colon + 1).trim().replace(/>$/, "").trim();
    const open = body.lastIndexOf("(");
    const close = body.lastIndexOf(")");
    if (open < 0 || close <= open) return undefined;
    const before = body.slice(0, open).trim();
    const params = splitParameterTypes(body.slice(open + 1, close));
    const methodMatch = before.match(/(?:^|\.)(?:\[(static)\])?([A-Za-z_$][\w$]*)$/);
    if (!methodMatch) return undefined;
    const methodName = stableToken(methodMatch[2]);
    const ownerText = before.slice(0, methodMatch.index ?? before.length).replace(/\.$/, "").trim();
    const ownerName = stableToken(ownerText
        .replace(/\.\[static\]$/, "")
        .split(".")
        .filter(Boolean)
        .join("."));
    if (!modulePath || !methodName) return undefined;
    if (!ownerName) {
        return {
            modulePath,
            functionName: methodName,
            parameterTypes: params,
            invokeKindHint: "free-function",
        };
    }
    return {
        modulePath,
        ownerName,
        methodName,
        parameterTypes: params,
        invokeKindHint: methodMatch[1] === "static" ? "static" : undefined,
    };
}

function splitParameterTypes(paramsText: string): string[] {
    const body = String(paramsText || "").trim();
    if (!body) return [];
    const out: string[] = [];
    let depth = 0;
    let current = "";
    for (const ch of body) {
        if (ch === "<" || ch === "(" || ch === "[" || ch === "{") depth++;
        if (ch === ">" || ch === ")" || ch === "]" || ch === "}") depth = Math.max(0, depth - 1);
        if (ch === "," && depth === 0) {
            out.push(current.trim());
            current = "";
            continue;
        }
        current += ch;
    }
    if (current.trim()) out.push(current.trim());
    return out;
}

function stableModulePath(value: unknown): string {
    const text = String(value || "")
        .replace(/^<+@?/, "")
        .replace(/^@/, "")
        .replace(/\\/g, "/")
        .trim();
    if (!text || text.includes("%unk") || text.includes("@unk")) return "";
    return text;
}

function stableToken(value: unknown): string {
    const text = String(value || "").trim();
    if (!text || text.includes("%unk") || text.includes("@unk")) return "";
    return text;
}

function stableId(value: unknown): string {
    return String(value || "surface")
        .replace(/[^A-Za-z0-9_.-]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 160) || "surface";
}
