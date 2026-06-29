import type { AssetBinding, AssetRole } from "./BindingTypes";
import type { AssetDocumentBase } from "./AssetTypes";
import type {
    AssetCoverageExplanation,
    AssetConflict,
    BindingFilter,
    CoverageQuery,
    CoverageResult,
    IdentityResult,
    UnmigratedAssetReport,
} from "./CoverageTypes";
import type { AssetEndpoint, AssetGuard, EndpointRelation, GuardRelation, StructuredCondition } from "./EndpointTypes";
import type { AssetSurface } from "./SurfaceTypes";
import type { ValidationResult } from "./CommonTypes";
import { isTrustedAnalysisAssetStatus } from "./CommonTypes";
import { validateAssetDocument } from "./AssetSchemaValidator";
import type { SemanticEffectTemplate } from "./EffectTemplateTypes";
import { assertValidCanonicalApiId } from "../../api/identity";

export interface AssetIdentityIndexOptions {
    canonicalApiRegistry: {
        has(canonicalApiId: string): boolean;
    };
}

export function resolveCanonicalAssetIdentity(surface: AssetSurface): IdentityResult {
    const canonicalApiId = surface.canonicalApiId;
    if (!stable(canonicalApiId)) {
        return { status: "unresolved", reason: "surface is missing canonicalApiId" };
    }
    try {
        assertValidCanonicalApiId(canonicalApiId);
    } catch (error) {
        return {
            status: "unresolved",
            reason: error instanceof Error ? error.message : String(error),
        };
    }
    return { status: "resolved", canonicalApiId };
}

export function endpointKey(endpoint?: AssetEndpoint): string {
    return canonicalJson(endpoint || null);
}

export function guardKey(guard?: AssetGuard): string {
    return canonicalJson(guard || null);
}

export function compareEndpoints(existing?: AssetEndpoint, candidate?: AssetEndpoint): EndpointRelation {
    if (!existing && !candidate) return "exact";
    if (!existing || !candidate) return "unknown";
    const existingBase = canonicalJson(existing.base);
    const candidateBase = canonicalJson(candidate.base);
    if (existingBase !== candidateBase) return "disjoint";
    const leftPath = existing.accessPath || [];
    const rightPath = candidate.accessPath || [];
    if (pathEquals(leftPath, rightPath)) return "exact";
    if (isPrefix(leftPath, rightPath)) return "subsumes";
    if (isPrefix(rightPath, leftPath)) return "subsumed-by";
    return "disjoint";
}

export function compareGuards(existing?: AssetGuard, candidate?: AssetGuard): GuardRelation {
    if (!existing && !candidate) return "equivalent";
    if (!existing || !candidate) return "overlap";
    if (guardKey(existing) === guardKey(candidate)) return "equivalent";
    const left = existing.conditions || [];
    const right = candidate.conditions || [];
    for (const leftCondition of left) {
        for (const rightCondition of right) {
            if (conditionsDisjoint(leftCondition, rightCondition)) return "disjoint";
        }
    }
    return "overlap";
}

interface IndexedBinding {
    asset: AssetDocumentBase;
    surface: AssetSurface;
    binding: AssetBinding;
}

interface IndexedSurface {
    asset: AssetDocumentBase;
    surface: AssetSurface;
}

interface AssetIndexingPlan {
    trusted: boolean;
    templates: SemanticEffectTemplate[];
    surfaces: IndexedSurface[];
    bindings: IndexedBinding[];
}

export class AssetIdentityIndex {
    private readonly assets = new Map<string, AssetDocumentBase>();
    private readonly bindingsByCanonicalApiId = new Map<string, IndexedBinding[]>();
    private readonly surfacesByCanonicalApiId = new Map<string, AssetSurface[]>();
    private readonly surfacesById = new Map<string, IndexedSurface[]>();
    private readonly bindingsById = new Map<string, IndexedBinding[]>();
    private readonly surfacesByQualifiedId = new Map<string, IndexedSurface>();
    private readonly bindingsByQualifiedId = new Map<string, IndexedBinding>();
    private readonly templatesById = new Map<string, SemanticEffectTemplate>();
    private readonly conflicts: AssetConflict[] = [];
    private readonly unmigrated: UnmigratedAssetReport[] = [];
    private readonly options: AssetIdentityIndexOptions;

    constructor(options: AssetIdentityIndexOptions) {
        if (!options?.canonicalApiRegistry) {
            throw new Error("AssetIdentityIndex requires a CanonicalApiRegistry for trusted asset indexing");
        }
        this.options = options;
    }

    addAsset(asset: AssetDocumentBase): void {
        const plan = this.prepareAssetIndexing(asset);
        this.assets.set(asset.id, asset);
        for (const template of plan.templates) {
            this.templatesById.set(template.id, template);
        }
        if (!plan.trusted) return;

        for (const item of plan.surfaces) {
            const canonicalApiId = item.surface.canonicalApiId!;
            const surfaceList = this.surfacesByCanonicalApiId.get(canonicalApiId) || [];
            surfaceList.push(item.surface);
            this.surfacesByCanonicalApiId.set(canonicalApiId, surfaceList);
            const surfaceListById = this.surfacesById.get(item.surface.surfaceId) || [];
            surfaceListById.push(item);
            this.surfacesById.set(item.surface.surfaceId, surfaceListById);
            this.surfacesByQualifiedId.set(qualifiedObjectId(item.asset.id, item.surface.surfaceId), item);
        }

        for (const item of plan.bindings) {
            const canonicalApiId = item.binding.canonicalApiId!;
            const current = this.bindingsByCanonicalApiId.get(canonicalApiId) || [];
            if (!current.some(existing => equivalentBinding(existing.binding, item.binding))) {
                current.push(item);
            }
            this.bindingsByCanonicalApiId.set(canonicalApiId, current);
            const bindingListById = this.bindingsById.get(item.binding.bindingId) || [];
            bindingListById.push(item);
            this.bindingsById.set(item.binding.bindingId, bindingListById);
            this.bindingsByQualifiedId.set(qualifiedObjectId(item.asset.id, item.binding.bindingId), item);
        }
    }

    private prepareAssetIndexing(asset: AssetDocumentBase): AssetIndexingPlan {
        const validation = validateAssetDocument(asset);
        if (!validation.valid) {
            throw new Error(`invalid asset ${asset.id}: ${validation.errors.join("; ")}`);
        }

        if (this.assets.has(asset.id)) {
            throw new Error(`duplicate assetId ${asset.id}`);
        }

        const errors: string[] = [];
        const templates = asset.effectTemplates || [];
        for (const template of asset.effectTemplates || []) {
            const existing = this.templatesById.get(template.id);
            if (existing && canonicalJson(existing) !== canonicalJson(template)) {
                errors.push(`${asset.id}:${template.id} effectTemplateId conflicts with an existing template`);
            }
        }
        if (!isTrustedAnalysisAssetStatus(asset.status)) {
            if (errors.length > 0) {
                throw new Error(`invalid asset ${asset.id}: ${errors.join("; ")}`);
            }
            return { trusted: false, templates, surfaces: [], bindings: [] };
        }

        const surfaces: IndexedSurface[] = [];
        const bindings: IndexedBinding[] = [];
        const surfaceIdsInPlan = new Set<string>();
        const bindingIdsInPlan = new Set<string>();
        for (const surface of asset.surfaces) {
            const identity = resolveCanonicalAssetIdentity(surface);
            if (identity.status !== "resolved" || !identity.canonicalApiId) {
                errors.push(`${asset.id}:${surface.surfaceId} ${identity.reason || "canonicalApiId unresolved"}`);
                continue;
            }
            if (surface.surfaceId === identity.canonicalApiId) {
                errors.push(`${asset.id}:${surface.surfaceId} surfaceId must be an object id, not canonicalApiId`);
            }
            if (surfaceIdsInPlan.has(surface.surfaceId)) {
                errors.push(`${asset.id}:${surface.surfaceId} duplicate surfaceId`);
            }
            surfaceIdsInPlan.add(surface.surfaceId);
            if (this.surfacesByQualifiedId.has(qualifiedObjectId(asset.id, surface.surfaceId))) {
                errors.push(`${asset.id}:${surface.surfaceId} surfaceId conflicts with an existing surface in the same asset`);
            }
            if (!this.options.canonicalApiRegistry.has(identity.canonicalApiId)) {
                errors.push(`${asset.id}:${surface.surfaceId} canonicalApiId is not registered: ${identity.canonicalApiId}`);
                continue;
            }
            surfaces.push({ asset, surface });
            for (const binding of asset.bindings.filter(item => item.surfaceId === surface.surfaceId)) {
                if (binding.bindingId === identity.canonicalApiId) {
                    errors.push(`${asset.id}:${binding.bindingId} bindingId must be an object id, not canonicalApiId`);
                }
                if (bindingIdsInPlan.has(binding.bindingId)) {
                    errors.push(`${asset.id}:${binding.bindingId} duplicate bindingId`);
                }
                bindingIdsInPlan.add(binding.bindingId);
                if (this.bindingsByQualifiedId.has(qualifiedObjectId(asset.id, binding.bindingId))) {
                    errors.push(`${asset.id}:${binding.bindingId} bindingId conflicts with an existing binding in the same asset`);
                }
                if (binding.canonicalApiId !== identity.canonicalApiId) {
                    errors.push(`${asset.id}:${binding.bindingId} canonicalApiId does not match surface ${surface.surfaceId}`);
                    continue;
                }
                bindings.push({ asset, surface, binding });
            }
        }

        if (errors.length > 0) {
            throw new Error(`invalid trusted asset ${asset.id}: ${errors.join("; ")}`);
        }
        return { trusted: true, templates, surfaces, bindings };
    }

    resolveIdentity(surface: AssetSurface): IdentityResult {
        return resolveCanonicalAssetIdentity(surface);
    }

    queryCoverage(query: CoverageQuery): CoverageResult {
        const identityProblem = this.queryCanonicalApiIdProblem(query.canonicalApiId);
        if (identityProblem) {
            return coverage("identity-unresolved", [], identityProblem);
        }
        const candidates = (this.bindingsByCanonicalApiId.get(query.canonicalApiId) || [])
            .filter(item => !query.plane || item.binding.plane === query.plane);
        const expectedRoles = expectedRolesFromQuery(query);

        if (candidates.length === 0) {
            return coverage("not-covered", [], `no binding registered for canonicalApiId ${query.canonicalApiId}`);
        }

        const roleMatches = expectedRoles.length === 0
            ? candidates
            : candidates.filter(item => expectedRoles.includes(item.binding.role));
        if (roleMatches.length === 0) {
            return {
                ...coverage(
                    "covered-surface-but-role-missing",
                    candidates.map(item => item.binding),
                    "canonicalApiId is covered, but requested role is missing",
                ),
                missingRoles: expectedRoles,
            };
        }

        let bestPartial: CoverageResult | undefined;
        for (const item of roleMatches) {
            const endpointRelation = compareEndpoints(item.binding.endpoint, query.endpoint);
            const guardRelation = compareGuards(item.binding.guard, query.guard);
            if (endpointRelation === "disjoint" || guardRelation === "disjoint") {
                continue;
            }
            const endpointCovered = endpointRelation === "exact"
                || (endpointRelation === "subsumes" && item.binding.completeness === "complete");
            const guardCovered = guardRelation === "equivalent" || guardRelation === "implies";
            if (endpointCovered && guardCovered && item.binding.confidence !== "unknown") {
                return {
                    status: "covered-exact-role",
                    matchedBindings: [item.binding],
                    endpointRelation,
                    guardRelation,
                    explanation: explain(
                        "exact canonicalApiId, role, endpoint, and guard coverage",
                        [item.asset.id],
                        [item.binding.bindingId],
                    ),
                };
            }
            bestPartial = {
                status: "covered-partial",
                matchedBindings: [item.binding],
                endpointRelation,
                guardRelation,
                explanation: explain(
                    "role is present but endpoint/guard/completeness is not exact enough for covered filtering",
                    [item.asset.id],
                    [item.binding.bindingId],
                ),
            };
        }

        if (bestPartial) return bestPartial;
        return coverage("not-covered", [], "matching canonicalApiId and role exist, but endpoint or guard is disjoint");
    }

    findBindings(canonicalApiId: string, filter?: BindingFilter): AssetBinding[] {
        return (this.bindingsByCanonicalApiId.get(canonicalApiId) || [])
            .filter(item => !filter?.plane || item.binding.plane === filter.plane)
            .filter(item => !filter?.roles || filter.roles.includes(item.binding.role))
            .filter(item => !filter?.endpoint || compareEndpoints(item.binding.endpoint, filter.endpoint) !== "disjoint")
            .filter(item => !filter?.guard || compareGuards(item.binding.guard, filter.guard) !== "disjoint")
            .map(item => item.binding);
    }

    findSurfaces(canonicalApiId: string): AssetSurface[] {
        return [...(this.surfacesByCanonicalApiId.get(canonicalApiId) || [])];
    }

    getAsset(assetId: string): AssetDocumentBase | undefined {
        return this.assets.get(assetId);
    }

    getSurface(surfaceId: string): AssetSurface | undefined {
        const matches = this.surfacesById.get(surfaceId) || [];
        return matches.length === 1 ? matches[0].surface : undefined;
    }

    getBinding(bindingId: string): AssetBinding | undefined {
        const matches = this.bindingsById.get(bindingId) || [];
        return matches.length === 1 ? matches[0].binding : undefined;
    }

    getTemplate(templateId: string): SemanticEffectTemplate | undefined {
        return this.templatesById.get(templateId);
    }

    explainCoverage(query: CoverageQuery): AssetCoverageExplanation {
        return this.queryCoverage(query).explanation;
    }

    validateAsset(asset: AssetDocumentBase): ValidationResult {
        return validateAssetDocument(asset);
    }

    listConflicts(): AssetConflict[] {
        return [...this.conflicts];
    }

    listUnmigratedAssets(): UnmigratedAssetReport[] {
        return [...this.unmigrated];
    }

    private queryCanonicalApiIdProblem(canonicalApiId: string): string | undefined {
        try {
            assertValidCanonicalApiId(canonicalApiId);
        } catch (error) {
            return error instanceof Error ? error.message : String(error);
        }
        if (!this.options.canonicalApiRegistry.has(canonicalApiId)) {
            return `canonicalApiId is not registered: ${canonicalApiId}`;
        }
        return undefined;
    }
}

export function createAssetIdentityIndex(options: AssetIdentityIndexOptions): AssetIdentityIndex {
    return new AssetIdentityIndex(options);
}

function expectedRolesFromQuery(query: CoverageQuery): AssetRole[] {
    if (query.expectedRoles?.length) return query.expectedRoles;
    if (query.candidatePurpose && query.candidatePurpose !== "unknown") {
        return [query.candidatePurpose === "entry" ? "entry" : query.candidatePurpose as AssetRole];
    }
    return [];
}

function coverage(status: CoverageResult["status"], bindings: AssetBinding[], reason: string): CoverageResult {
    return {
        status,
        matchedBindings: bindings,
        explanation: explain(reason, [], bindings.map(binding => binding.bindingId)),
    };
}

function explain(reason: string, assetIds: string[] = [], bindingIds: string[] = []): AssetCoverageExplanation {
    return {
        reason,
        matchedAssetIds: assetIds,
        matchedBindingIds: bindingIds,
    };
}

function conditionsDisjoint(left: StructuredCondition, right: StructuredCondition): boolean {
    if ((left.kind === "const-eq" || left.kind === "const-neq")
        && (right.kind === "const-eq" || right.kind === "const-neq")
        && endpointKey(left.endpoint) === endpointKey(right.endpoint)) {
        if (left.kind === "const-eq" && right.kind === "const-eq") {
            return left.value !== right.value;
        }
        if (left.kind === "const-eq" && right.kind === "const-neq") {
            return left.value === right.value;
        }
        if (left.kind === "const-neq" && right.kind === "const-eq") {
            return left.value === right.value;
        }
    }
    return false;
}

function equivalentBinding(left: AssetBinding, right: AssetBinding): boolean {
    return left.canonicalApiId === right.canonicalApiId
        && left.role === right.role
        && endpointKey(left.endpoint) === endpointKey(right.endpoint)
        && guardKey(left.guard) === guardKey(right.guard)
        && canonicalJson(left.effectTemplateRefs || []) === canonicalJson(right.effectTemplateRefs || []);
}

function stable(value: unknown): value is string {
    if (typeof value !== "string") return false;
    const text = value.trim();
    return text.length > 0 && !text.includes("%unk") && !text.includes("@unk");
}

function qualifiedObjectId(assetId: string, localId: string): string {
    return `${assetId}#${localId}`;
}

function pathEquals(left: string[], right: string[]): boolean {
    return left.length === right.length && left.every((item, index) => item === right[index]);
}

function isPrefix(prefix: string[], value: string[]): boolean {
    return prefix.length < value.length && prefix.every((item, index) => item === value[index]);
}

function canonicalJson(value: unknown): string {
    return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(value as Record<string, unknown>).sort()) {
            const child = (value as Record<string, unknown>)[key];
            if (child !== undefined) out[key] = canonicalize(child);
        }
        return out;
    }
    return value;
}
