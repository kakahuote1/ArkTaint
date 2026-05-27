import type { AssetBinding, AssetRole } from "./BindingTypes";
import type { AssetDocumentBase } from "./AssetTypes";
import type { CoverageQuery, CoverageResult, AssetCoverageExplanation, IdentityResult, BindingFilter, AssetConflict, UnmigratedAssetReport } from "./CoverageTypes";
import type { AssetEndpoint, AssetGuard, EndpointRelation, GuardRelation, StructuredCondition } from "./EndpointTypes";
import type { AssetIdentity, AssetSurface, CallbackIdentity, InvokeIdentity, InvokeSurface } from "./SurfaceTypes";
import { validateAssetDocument } from "./AssetSchemaValidator";
import type { ValidationResult } from "./CommonTypes";

const coverageStatuses = new Set(["official", "reviewed", "replayed"]);

export function resolveAssetIdentity(surface: AssetSurface): IdentityResult {
    switch (surface.kind) {
        case "invoke":
            return resolveInvokeIdentity(surface);
        case "construct":
            if (!stable(surface.modulePath) || !stable(surface.className) || !nonNegative(surface.argCount)) {
                return unresolved("construct surface is missing stable modulePath/className/argCount");
            }
            return resolved({
                kind: "construct",
                modulePath: canonicalModulePath(surface.modulePath),
                className: surface.className,
                argCount: surface.argCount,
                parameterTypes: surface.parameterTypes,
                signatureId: surface.signatureId,
            });
        case "access":
            if (!stable(surface.modulePath) || !stable(surface.ownerName) || !stable(surface.propertyName)) {
                return unresolved("access surface is missing stable modulePath/ownerName/propertyName");
            }
            return resolved({
                kind: "access",
                modulePath: canonicalModulePath(surface.modulePath),
                ownerName: surface.ownerName,
                propertyName: surface.propertyName,
                accessKind: surface.accessKind,
                receiverKind: surface.receiverKind,
            });
        case "entry":
            if (!stable(surface.ownerName) || !stable(surface.methodName) || !stable(surface.phase) || !stable(surface.entryKind)) {
                return unresolved("entry surface is missing stable ownerName/methodName/phase/entryKind");
            }
            return resolved({
                kind: "entry",
                ownerKind: surface.ownerKind,
                ownerName: surface.ownerName,
                methodName: surface.methodName,
                phase: surface.phase,
                entryKind: surface.entryKind,
            });
        case "callback": {
            const registrar = resolveInvokeIdentity(surface.registrar);
            if (registrar.status !== "resolved" || !registrar.identity || registrar.identity.kind !== "invoke") {
                return unresolved("callback registrar identity is unresolved");
            }
            return resolved({
                kind: "callback",
                registrar: registrar.identity,
                callback: surface.callback,
                callbackRole: surface.callbackRole,
            });
        }
        case "decorator":
            if (!stable(surface.decoratorName) || !stable(surface.ownerName)) {
                return unresolved("decorator surface is missing stable decoratorName/ownerName");
            }
            return resolved({
                kind: "decorator",
                decoratorName: surface.decoratorName,
                ownerKind: surface.ownerKind,
                ownerName: surface.ownerName,
                fieldName: surface.fieldName,
                argCount: surface.argCount,
            });
        default:
            return unresolved("unknown surface kind");
    }
}

export function assetIdentityKey(identity: AssetIdentity): string {
    return canonicalJson(identity);
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

export class InMemoryAssetSurfaceRegistry {
    private readonly assets = new Map<string, AssetDocumentBase>();
    private readonly bindingsByIdentity = new Map<string, Array<{ asset: AssetDocumentBase; binding: AssetBinding; identity: AssetIdentity }>>();
    private readonly conflicts: AssetConflict[] = [];
    private readonly unmigrated: UnmigratedAssetReport[] = [];

    addAsset(asset: AssetDocumentBase): void {
        const validation = validateAssetDocument(asset);
        if (!validation.valid) {
            throw new Error(`invalid asset ${asset.id}: ${validation.errors.join("; ")}`);
        }
        this.assets.set(asset.id, asset);
        if (!coverageStatuses.has(asset.status)) {
            return;
        }
        for (const surface of asset.surfaces) {
            const identityResult = resolveAssetIdentity(surface);
            if (identityResult.status !== "resolved" || !identityResult.identity) {
                this.unmigrated.push({ assetId: asset.id, reason: identityResult.reason || "identity unresolved" });
                continue;
            }
            for (const binding of asset.bindings.filter(item => item.surfaceId === surface.surfaceId)) {
                const key = assetIdentityKey(identityResult.identity);
                const current = this.bindingsByIdentity.get(key) || [];
                current.push({ asset, binding, identity: identityResult.identity });
                this.bindingsByIdentity.set(key, current);
            }
        }
    }

    resolveIdentity(surface: AssetSurface): IdentityResult {
        return resolveAssetIdentity(surface);
    }

    queryCoverage(query: CoverageQuery): CoverageResult {
        const key = assetIdentityKey(query.identity);
        const candidates = (this.bindingsByIdentity.get(key) || [])
            .filter(item => !query.plane || item.binding.plane === query.plane);
        const expectedRoles = expectedRolesFromQuery(query);

        if (candidates.length === 0) {
            return coverage("not-covered", [], "no reviewed/replayed/official binding has the exact asset identity");
        }

        const roleMatches = expectedRoles.length === 0
            ? candidates
            : candidates.filter(item => expectedRoles.includes(item.binding.role));
        if (roleMatches.length === 0) {
            return {
                ...coverage("covered-surface-but-role-missing", candidates.map(item => item.binding), "asset identity is covered, but requested role is missing"),
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
                    explanation: explain("exact role, endpoint, and guard coverage", [item.asset.id], [item.binding.bindingId]),
                };
            }
            bestPartial = {
                status: "covered-partial",
                matchedBindings: [item.binding],
                endpointRelation,
                guardRelation,
                explanation: explain("role is present but endpoint/guard/completeness is not exact enough for known-covered filtering", [item.asset.id], [item.binding.bindingId]),
            };
        }

        if (bestPartial) return bestPartial;
        return coverage("not-covered", [], "matching identity and role exist, but endpoint or guard is disjoint");
    }

    findBindings(identity: AssetIdentity, filter?: BindingFilter): AssetBinding[] {
        const key = assetIdentityKey(identity);
        return (this.bindingsByIdentity.get(key) || [])
            .filter(item => !filter?.plane || item.binding.plane === filter.plane)
            .filter(item => !filter?.roles || filter.roles.includes(item.binding.role))
            .filter(item => !filter?.endpoint || compareEndpoints(item.binding.endpoint, filter.endpoint) !== "disjoint")
            .filter(item => !filter?.guard || compareGuards(item.binding.guard, filter.guard) !== "disjoint")
            .map(item => item.binding);
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
}

export function createAssetSurfaceRegistry(): InMemoryAssetSurfaceRegistry {
    return new InMemoryAssetSurfaceRegistry();
}

function resolveInvokeIdentity(surface: InvokeSurface): IdentityResult {
    if (!stable(surface.modulePath) || !nonNegative(surface.argCount)) {
        return unresolved("invoke surface is missing stable modulePath/argCount");
    }
    if (surface.invokeKind === "instance" || surface.invokeKind === "static") {
        if (!stable(surface.ownerName) || !stable(surface.methodName)) {
            return unresolved("instance/static invoke surface requires stable ownerName and methodName");
        }
    } else if (surface.invokeKind === "free-function") {
        if (!stable(surface.functionName)) {
            return unresolved("free-function invoke surface requires stable functionName");
        }
    } else if (!stable(surface.ownerName) && !stable(surface.functionName)) {
        return unresolved("namespace invoke surface requires stable ownerName or functionName");
    }
    return resolved({
        kind: "invoke",
        modulePath: canonicalModulePath(surface.modulePath),
        ownerName: surface.ownerName,
        functionName: surface.functionName,
        methodName: surface.methodName,
        invokeKind: surface.invokeKind,
        argCount: surface.argCount,
        parameterTypes: surface.parameterTypes,
        signatureId: surface.signatureId,
    });
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

function resolved(identity: AssetIdentity): IdentityResult {
    return { status: "resolved", identity };
}

function unresolved(reason: string): IdentityResult {
    return { status: "unresolved", reason };
}

function stable(value: unknown): value is string {
    if (typeof value !== "string") return false;
    const text = value.trim();
    return text.length > 0 && !text.includes("%unk") && !text.includes("@unk");
}

function canonicalModulePath(value: string): string {
    return String(value || "")
        .replace(/\\/g, "/")
        .replace(/^@/, "")
        .replace(/^\.\//, "")
        .replace(/^project\//, "")
        .trim();
}

function nonNegative(value: unknown): value is number {
    return Number.isInteger(value) && Number(value) >= 0;
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
