import type { AssetDocumentBase } from "../assets/schema";
import { lowerRuleAssetsToRuleSet } from "../rules/RuleAssetLowering";
import type { TaintRuleSet } from "../rules/RuleSchema";
import type {
    SemanticFlowAnalysisAugment,
    SemanticFlowEngineAugment,
    SemanticFlowItemResult,
} from "./SemanticFlowTypes";

export interface SemanticFlowAugmentConflict {
    anchorId: string;
    assetId: string;
    error: string;
}

export interface SemanticFlowAugmentStabilization {
    items: SemanticFlowItemResult[];
    augment: SemanticFlowAnalysisAugment;
    conflicts: SemanticFlowAugmentConflict[];
}

export function buildSemanticFlowAnalysisAugment(items: SemanticFlowItemResult[]): SemanticFlowAnalysisAugment {
    return stabilizeSemanticFlowItemsForAugment(items).augment;
}

export function stabilizeSemanticFlowItemsForAugment(
    items: SemanticFlowItemResult[],
): SemanticFlowAugmentStabilization {
    const stabilizedItems: SemanticFlowItemResult[] = [];
    const conflicts: SemanticFlowAugmentConflict[] = [];
    let acceptedAssets: AssetDocumentBase[] = [];
    let acceptedAugment = buildSemanticFlowAnalysisAugmentFromAssets([]);

    for (const item of items) {
        if (!item.asset) {
            stabilizedItems.push(item);
            continue;
        }
        try {
            const nextAugment = buildSemanticFlowAnalysisAugmentFromAssets([...acceptedAssets, item.asset]);
            acceptedAssets = nextAugment.assets;
            acceptedAugment = nextAugment;
            stabilizedItems.push(item);
        } catch (error) {
            const detail = String((error as any)?.message || error);
            conflicts.push({
                anchorId: item.anchor.id,
                assetId: item.asset.id,
                error: detail,
            });
            stabilizedItems.push({
                ...item,
                plane: undefined,
                resolution: "need-human-check",
                asset: undefined,
                error: `semanticflow generated asset excluded from augment: ${detail}`,
            });
        }
    }

    return {
        items: stabilizedItems,
        augment: acceptedAugment,
        conflicts,
    };
}

export function buildSemanticFlowAnalysisAugmentFromAssets(assets: AssetDocumentBase[]): SemanticFlowAnalysisAugment {
    const dedupedAssets = dedupeAssets(assets);
    const ruleLowering = lowerRuleAssetsToRuleSet(dedupedAssets);
    return {
        assets: dedupedAssets,
        ruleSet: ruleLowering.ruleSet,
    };
}

export function mergeSemanticFlowAnalysisAugments(
    augments: SemanticFlowAnalysisAugment[],
): SemanticFlowAnalysisAugment {
    return buildSemanticFlowAnalysisAugmentFromAssets(augments.flatMap(augment => augment.assets || []));
}

export function consolidateSemanticFlowAnalysisAugmentByFootprint(
    augment: SemanticFlowAnalysisAugment,
): SemanticFlowAnalysisAugment {
    return buildSemanticFlowAnalysisAugmentFromAssets(augment.assets || []);
}

export function buildSemanticFlowEngineAugment(augment: SemanticFlowAnalysisAugment): SemanticFlowEngineAugment {
    return {
        sourceRules: augment.ruleSet.sources || [],
        sinkRules: augment.ruleSet.sinks || [],
        sanitizerRules: augment.ruleSet.sanitizers || [],
        transferRules: augment.ruleSet.transfers || [],
    };
}

export function mergeRuleSets(left: TaintRuleSet, right: TaintRuleSet): TaintRuleSet {
    return {
        sources: [...(left.sources || []), ...(right.sources || [])],
        sinks: [...(left.sinks || []), ...(right.sinks || [])],
        sanitizers: [...(left.sanitizers || []), ...(right.sanitizers || [])],
        transfers: [...(left.transfers || []), ...(right.transfers || [])],
    };
}

function dedupeAssets(assets: AssetDocumentBase[]): AssetDocumentBase[] {
    const byKey = new Map<string, AssetDocumentBase>();
    for (const asset of assets) {
        const key = `${asset.plane}:${asset.id}`;
        const previous = byKey.get(key);
        if (!previous) {
            byKey.set(key, asset);
            continue;
        }
        byKey.set(key, mergeSameAsset(previous, asset));
    }
    return [...byKey.values()];
}

function mergeSameAsset(left: AssetDocumentBase, right: AssetDocumentBase): AssetDocumentBase {
    if (left.id !== right.id || left.plane !== right.plane) {
        throw new Error(`semanticflow asset merge requires same plane/id, got ${left.plane}:${left.id} and ${right.plane}:${right.id}`);
    }
    const bindings = mergeById(left.bindings || [], right.bindings || [], item => item.bindingId, "bindingId");
    return {
        ...left,
        status: higherStatus(left.status, right.status),
        surfaces: mergeById(left.surfaces || [], right.surfaces || [], item => item.surfaceId, "surfaceId"),
        bindings: dedupeEquivalentBindings(bindings),
        effectTemplates: mergeById(
            left.effectTemplates || [],
            right.effectTemplates || [],
            item => item.id,
            "effectTemplate id",
        ),
        relations: mergeById(left.relations || [], right.relations || [], item => item.relationId, "relationId"),
        provenance: {
            ...left.provenance,
            projectId: left.provenance.projectId || right.provenance.projectId,
            sdkVersion: left.provenance.sdkVersion || right.provenance.sdkVersion,
            createdAt: left.provenance.createdAt || right.provenance.createdAt,
            createdBy: left.provenance.createdBy || right.provenance.createdBy,
            reviewedBy: left.provenance.reviewedBy || right.provenance.reviewedBy,
            evidenceLocations: mergeEvidenceLocations(
                left.provenance.evidenceLocations || [],
                right.provenance.evidenceLocations || [],
            ),
        },
    };
}

function mergeById<T>(
    left: T[],
    right: T[],
    getId: (item: T) => string | undefined,
    label: string,
): T[] {
    const byId = new Map<string, T>();
    for (const item of [...left, ...right]) {
        const id = getId(item);
        if (!id) {
            throw new Error(`semanticflow asset merge encountered missing ${label}`);
        }
        const previous = byId.get(id);
        if (!previous) {
            byId.set(id, item);
            continue;
        }
        byId.set(id, mergeCompatibleById(previous, item, label, id));
    }
    return [...byId.values()];
}

function dedupeEquivalentBindings(bindings: AssetDocumentBase["bindings"]): AssetDocumentBase["bindings"] {
    const byKey = new Map<string, AssetDocumentBase["bindings"][number]>();
    for (const binding of bindings) {
        const key = [
            binding.surfaceId,
            binding.role,
            stableSerialize(binding.endpoint),
            stableSerialize(binding.guard),
            stableSerialize(binding.effectTemplateRefs || []),
            stableSerialize(binding.relationRefs || []),
        ].join("|");
        const previous = byKey.get(key);
        if (!previous) {
            byKey.set(key, binding);
            continue;
        }
        const merged = mergeCompatibleValue(
            equivalentBindingShape(previous),
            equivalentBindingShape(binding),
        );
        if (merged === undefined) {
            throw new Error(`semanticflow asset merge conflict for equivalent binding ${previous.bindingId} / ${binding.bindingId}`);
        }
        byKey.set(key, {
            ...(merged as AssetDocumentBase["bindings"][number]),
            bindingId: previous.bindingId,
            assetId: previous.assetId,
        });
    }
    return [...byKey.values()];
}

function equivalentBindingShape(
    binding: AssetDocumentBase["bindings"][number],
): Omit<AssetDocumentBase["bindings"][number], "bindingId" | "assetId"> {
    const { bindingId: _bindingId, assetId: _assetId, ...shape } = binding;
    return shape;
}

function mergeCompatibleById<T>(left: T, right: T, label: string, id: string): T {
    const merged = mergeCompatibleValue(left, right);
    if (merged === undefined) {
        throw new Error(`semanticflow asset merge conflict for duplicate ${label} ${id}`);
    }
    return merged as T;
}

function mergeCompatibleValue(left: unknown, right: unknown): unknown | undefined {
    if (stableSerialize(left) === stableSerialize(right)) {
        return left;
    }
    if (left === undefined) return right;
    if (right === undefined) return left;
    if (Array.isArray(left) || Array.isArray(right)) {
        return undefined;
    }
    if (
        left &&
        right &&
        typeof left === "object" &&
        typeof right === "object"
    ) {
        const leftRecord = left as Record<string, unknown>;
        const rightRecord = right as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        for (const key of [...new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])]) {
            const merged = mergeCompatibleValue(leftRecord[key], rightRecord[key]);
            if (merged === undefined && leftRecord[key] !== undefined && rightRecord[key] !== undefined) {
                return undefined;
            }
            if (merged !== undefined) {
                out[key] = merged;
            }
        }
        return out;
    }
    return undefined;
}

function mergeEvidenceLocations(
    left: NonNullable<AssetDocumentBase["provenance"]["evidenceLocations"]>,
    right: NonNullable<AssetDocumentBase["provenance"]["evidenceLocations"]>,
): NonNullable<AssetDocumentBase["provenance"]["evidenceLocations"]> {
    return mergeById(left, right, item => `${item.file}:${item.line ?? ""}:${item.column ?? ""}`, "evidence location");
}

function higherStatus(left: AssetDocumentBase["status"], right: AssetDocumentBase["status"]): AssetDocumentBase["status"] {
    const rank: Record<AssetDocumentBase["status"], number> = {
        candidate: 0,
        "llm-generated": 1,
        "schema-valid": 2,
        reviewed: 3,
        replayed: 4,
        official: 5,
        deprecated: -1,
        rejected: -2,
    };
    return rank[right] > rank[left] ? right : left;
}

function stableSerialize(value: unknown): string {
    return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(sortJson);
    }
    if (value && typeof value === "object") {
        const record = value as Record<string, unknown>;
        const sorted: Record<string, unknown> = {};
        for (const key of Object.keys(record).sort()) {
            sorted[key] = sortJson(record[key]);
        }
        return sorted;
    }
    return value;
}
