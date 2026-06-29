import type { CanonicalApiDescriptor, IdentityEvidence } from "./CanonicalApiDescriptor";
import type { ArkanalyzerMethodKey } from "./CanonicalApiDescriptor";
import { arkanalyzerMethodKeyString, isKnownArkanalyzerMethodKey } from "./ArkanalyzerMethodKey";
import type { ImportMemberKey } from "./ImportMemberKey";
import {
    importMemberCandidateKeyFromImportMemberKey,
    importMemberCandidateKeyString,
    importMemberKeyString,
    importMemberSurfaceKeyFromImportMemberKey,
    importMemberSurfaceKeyString,
    knownShapeConstraintsFromImportMemberKey,
    type ImportMemberCandidateKey,
    type ImportMemberSurfaceKey,
    type KnownShapeConstraints,
} from "./ImportMemberKey";
import type { ReceiverMemberKey } from "./ReceiverMemberKey";
import {
    knownShapeConstraintsFromReceiverMemberKey,
    receiverMemberCandidateKeyString,
    receiverMemberSurfaceKeyString,
    receiverTypeCandidates,
    type ReceiverMemberCandidateKey,
    type ReceiverMemberSurfaceKey,
} from "./ReceiverMemberKey";
import type { ArkUiChainKey } from "./ArkUiChainKey";
import { arkUiChainKeyString } from "./ArkUiChainKey";
import type { ArkUiComponentKey } from "./ArkUiComponentKey";
import {
    arkUiComponentCandidateKeyFromArkUiComponentKey,
    arkUiComponentCandidateKeyString,
    arkUiComponentSurfaceKeyFromArkUiComponentKey,
    arkUiComponentSurfaceKeyString,
    knownShapeConstraintsFromArkUiComponentKey,
    type ArkUiComponentCandidateKey,
    type ArkUiComponentSurfaceKey,
} from "./ArkUiComponentKey";
import type { DecoratorKey } from "./DecoratorKey";
import { decoratorKeyString } from "./DecoratorKey";
import type { ProjectDeclarationKey } from "./ProjectDeclarationKey";
import { projectDeclarationKeyString } from "./ProjectDeclarationKey";
import { assertValidCanonicalApiId } from "./CanonicalApiId";
import { DeclarationShapeIndex } from "./DeclarationShapeIndex";
import {
    canonicalApiDescriptorResolutionEquivalenceKey,
    compareCanonicalApiDescriptorForRepresentative,
    isCanonicalApiDescriptorResolutionMirrorGroup,
} from "./CanonicalApiDescriptorSemanticKey";

export type ApiIdentityResolutionStatus = "accepted" | "unresolved" | "ambiguous" | "rejected";

export interface ApiIdentityResolution {
    status: ApiIdentityResolutionStatus;
    canonicalApiId?: string;
    candidates?: string[];
    reason: string;
    evidence: IdentityEvidence[];
}

export class CanonicalApiRegistry {
    private readonly byId = new Map<string, CanonicalApiDescriptor>();
    private readonly byArkanalyzerMethodKey = new Map<string, string[]>();
    private readonly byImportMemberKey = new Map<string, string[]>();
    private readonly byImportMemberCandidateKey = new Map<string, string[]>();
    private readonly byImportMemberSurfaceKey = new Map<string, string[]>();
    private readonly byReceiverMemberCandidateKey = new Map<string, string[]>();
    private readonly byReceiverMemberSurfaceKey = new Map<string, string[]>();
    private readonly byArkUiChainKey = new Map<string, string[]>();
    private readonly byArkUiComponentCandidateKey = new Map<string, string[]>();
    private readonly byArkUiComponentSurfaceKey = new Map<string, string[]>();
    private readonly byDecoratorKey = new Map<string, string[]>();
    private readonly byProjectDeclarationKey = new Map<string, string>();
    private readonly declarationShapeIndex: DeclarationShapeIndex;
    private descriptorSetChangeCount = 0;

    constructor(descriptors: readonly CanonicalApiDescriptor[] = []) {
        this.declarationShapeIndex = DeclarationShapeIndex.fromDescriptors(descriptors);
        for (const descriptor of descriptors) {
            this.addDescriptor(descriptor);
        }
    }

    addDescriptor(descriptor: CanonicalApiDescriptor): void {
        assertValidCanonicalApiId(descriptor.canonicalApiId);
        const existing = this.byId.get(descriptor.canonicalApiId);
        if (existing && JSON.stringify(existing) !== JSON.stringify(descriptor)) {
            throw new Error(`canonicalApiId collision for different descriptors: ${descriptor.canonicalApiId}`);
        }
        if (existing) return;
        this.byId.set(descriptor.canonicalApiId, descriptor);
        this.descriptorSetChangeCount++;
        if (descriptor.arkanalyzer && isKnownArkanalyzerMethodKey(descriptor.arkanalyzer)) {
            appendIndex(this.byArkanalyzerMethodKey, arkanalyzerMethodKeyString(descriptor.arkanalyzer), descriptor.canonicalApiId);
        }
        for (const key of importKeysForDescriptor(descriptor)) {
            appendIndex(this.byImportMemberKey, key, descriptor.canonicalApiId);
        }
        for (const key of importCandidateKeysForDescriptor(descriptor)) {
            appendIndex(this.byImportMemberCandidateKey, key, descriptor.canonicalApiId);
        }
        for (const key of importSurfaceKeysForDescriptor(descriptor)) {
            appendIndex(this.byImportMemberSurfaceKey, key, descriptor.canonicalApiId);
        }
        for (const key of receiverCandidateKeysForDescriptor(descriptor)) {
            appendIndex(this.byReceiverMemberCandidateKey, key, descriptor.canonicalApiId);
        }
        for (const key of receiverSurfaceKeysForDescriptor(descriptor)) {
            appendIndex(this.byReceiverMemberSurfaceKey, key, descriptor.canonicalApiId);
        }
        const arkUiKey = arkUiKeyForDescriptor(descriptor);
        if (arkUiKey) {
            appendIndex(this.byArkUiChainKey, arkUiKey, descriptor.canonicalApiId);
        }
        for (const key of arkUiComponentCandidateKeysForDescriptor(descriptor)) {
            appendIndex(this.byArkUiComponentCandidateKey, key, descriptor.canonicalApiId);
        }
        for (const key of arkUiComponentSurfaceKeysForDescriptor(descriptor)) {
            appendIndex(this.byArkUiComponentSurfaceKey, key, descriptor.canonicalApiId);
        }
        const decoratorKey = decoratorKeyForDescriptor(descriptor);
        if (decoratorKey) {
            appendIndex(this.byDecoratorKey, decoratorKey, descriptor.canonicalApiId);
        }
        const projectKey = projectKeyForDescriptor(descriptor);
        if (projectKey) {
            setUniqueIndex(this.byProjectDeclarationKey, projectKey, descriptor.canonicalApiId, "project declaration key");
        }
    }

    get(id: string): CanonicalApiDescriptor | undefined {
        return this.byId.get(id);
    }

    require(id: string): CanonicalApiDescriptor {
        const descriptor = this.get(id);
        if (!descriptor) throw new Error(`unknown canonicalApiId: ${id}`);
        return descriptor;
    }

    has(id: string): boolean {
        return this.byId.has(id);
    }

    listDescriptors(): CanonicalApiDescriptor[] {
        return [...this.byId.values()];
    }

    getDescriptorSetChangeCount(): number {
        return this.descriptorSetChangeCount;
    }

    resolveArkanalyzerMethodKey(key: ArkanalyzerMethodKey): ApiIdentityResolution {
        if (!isKnownArkanalyzerMethodKey(key)) {
            return unresolved("arkanalyzer_method_key_contains_unknown", { key });
        }
        const candidates = this.byArkanalyzerMethodKey.get(arkanalyzerMethodKeyString(key));
        if (!candidates) return unresolved("arkanalyzer_method_key_not_registered", { key });
        const collapsed = this.collapseResolutionEquivalentCandidates(candidates);
        return unique(collapsed.candidates, "arkanalyzer_method_key_exact", {
            key,
            candidates: [...new Set(candidates)],
            candidateCountBeforeIdentityEquivalence: [...new Set(candidates)].length,
            candidateCountAfterIdentityEquivalence: [...new Set(collapsed.candidates)].length,
            resolutionEquivalentGroups: collapsed.groups,
        });
    }

    resolveImportMemberKey(key: ImportMemberKey): ApiIdentityResolution {
        if (key.scopeEvidence.shadowed) {
            return rejected("import_binding_shadowed", { key });
        }
        if (!key.localBindingId || !key.moduleSpecifier || key.memberChain.length === 0) {
            return unresolved("import_member_key_incomplete", { key });
        }
        const exact = this.byImportMemberKey.get(importMemberKeyString(key));
        if (exact) {
            const collapsed = this.collapseResolutionEquivalentCandidates(exact);
            return unique(collapsed.candidates, "import_member_key_exact", {
                key,
                candidates: [...new Set(exact)],
                candidateCountBeforeIdentityEquivalence: [...new Set(exact)].length,
                candidateCountAfterIdentityEquivalence: [...new Set(collapsed.candidates)].length,
                resolutionEquivalentGroups: collapsed.groups,
            });
        }
        const candidateKey = importMemberCandidateKeyFromImportMemberKey(key);
        const arityCandidates = this.byImportMemberCandidateKey.get(importMemberCandidateKeyString(candidateKey));
        const surfaceKey = importMemberSurfaceKeyFromImportMemberKey(key);
        const surfaceCandidates = this.byImportMemberSurfaceKey.get(importMemberSurfaceKeyString(surfaceKey));
        const candidates = arityCandidates || filterCandidatesByAcceptedArity(surfaceCandidates || [], key.argShape.arity, this.byId);
        if (candidates.length === 0) {
            return unresolved("import_member_candidate_not_registered", { key, candidateKey, surfaceKey });
        }
        const constraints = knownShapeConstraintsFromImportMemberKey(key);
        const filtered = this.filterImportMemberCandidatesByKnownShape(candidates, constraints);
        const collapsed = this.collapseResolutionEquivalentCandidates(filtered.candidates);
        return resolveImportMemberCandidateSet(collapsed.candidates, {
            key,
            candidateKey,
            constraints,
            candidateCountBeforeShape: [...new Set(candidates)].length,
            candidateCountAfterShape: [...new Set(filtered.candidates)].length,
            candidateCountAfterIdentityEquivalence: [...new Set(collapsed.candidates)].length,
            candidates: [...new Set(candidates)],
            surfaceCandidates: [...new Set(surfaceCandidates || [])],
            shapeDiagnostics: filtered.diagnostics,
            resolutionEquivalentGroups: collapsed.groups,
        });
    }

    resolveReceiverMemberKey(key: ReceiverMemberKey): ApiIdentityResolution {
        if (!key.moduleSpecifier || !key.receiverType || !key.memberName) {
            return unresolved("receiver_member_key_incomplete", { key });
        }
        const receiverTypes = receiverTypeCandidates(key.receiverType);
        if (receiverTypes.length === 0) {
            return unresolved("receiver_member_type_unresolved", { key });
        }
        const candidateKeys = receiverMemberCandidateKeysFromReceiverMemberKey(key, receiverTypes);
        const surfaceKeys = receiverMemberSurfaceKeysFromReceiverMemberKey(key, receiverTypes);
        const arityCandidates = candidateKeys.flatMap(candidateKey => (
            this.byReceiverMemberCandidateKey.get(receiverMemberCandidateKeyString(candidateKey)) || []
        ));
        const surfaceCandidates = surfaceKeys.flatMap(surfaceKey => (
            this.byReceiverMemberSurfaceKey.get(receiverMemberSurfaceKeyString(surfaceKey)) || []
        ));
        const candidates = arityCandidates.length > 0
            ? arityCandidates
            : filterCandidatesByAcceptedArity(surfaceCandidates, key.argShape.arity, this.byId);
        if (candidates.length === 0) {
            return unresolved("receiver_member_candidate_not_registered", { key, receiverTypes, candidateKeys, surfaceKeys });
        }
        const constraints = knownShapeConstraintsFromReceiverMemberKey(key);
        const filtered = this.filterImportMemberCandidatesByKnownShape(candidates, constraints);
        const collapsed = this.collapseResolutionEquivalentCandidates(filtered.candidates);
        return resolveReceiverMemberCandidateSet(collapsed.candidates, {
            key,
            receiverTypes,
            candidateKeys,
            surfaceKeys,
            constraints,
            candidateCountBeforeShape: [...new Set(candidates)].length,
            candidateCountAfterShape: [...new Set(filtered.candidates)].length,
            candidateCountAfterIdentityEquivalence: [...new Set(collapsed.candidates)].length,
            candidates: [...new Set(candidates)],
            surfaceCandidates: [...new Set(surfaceCandidates)],
            shapeDiagnostics: filtered.diagnostics,
            resolutionEquivalentGroups: collapsed.groups,
        });
    }

    resolveArkUiChainKey(key: ArkUiChainKey): ApiIdentityResolution {
        const candidates = this.byArkUiChainKey.get(arkUiChainKeyString(key));
        return candidates
            ? unique(candidates, "arkui_chain_key_exact", { key })
            : unresolved("arkui_chain_key_not_registered", { key });
    }

    resolveArkUiComponentKey(key: ArkUiComponentKey): ApiIdentityResolution {
        if (!key.componentName || !key.memberName) {
            return unresolved("arkui_component_key_incomplete", { key });
        }
        const candidateKey = arkUiComponentCandidateKeyFromArkUiComponentKey(key);
        const arityCandidates = this.byArkUiComponentCandidateKey.get(arkUiComponentCandidateKeyString(candidateKey));
        const surfaceKey = arkUiComponentSurfaceKeyFromArkUiComponentKey(key);
        const surfaceCandidates = this.byArkUiComponentSurfaceKey.get(arkUiComponentSurfaceKeyString(surfaceKey));
        const candidates = arityCandidates || filterCandidatesByAcceptedArity(surfaceCandidates || [], key.argShape.arity, this.byId);
        if (candidates.length === 0) {
            return unresolved("arkui_component_candidate_not_registered", { key, candidateKey, surfaceKey });
        }
        const constraints = knownShapeConstraintsFromArkUiComponentKey(key);
        const filtered = this.filterImportMemberCandidatesByKnownShape(candidates, constraints);
        const collapsed = this.collapseResolutionEquivalentCandidates(filtered.candidates);
        return resolveArkUiComponentCandidateSet(collapsed.candidates, {
            key,
            candidateKey,
            constraints,
            candidateCountBeforeShape: [...new Set(candidates)].length,
            candidateCountAfterShape: [...new Set(filtered.candidates)].length,
            candidateCountAfterIdentityEquivalence: [...new Set(collapsed.candidates)].length,
            candidates: [...new Set(candidates)],
            surfaceCandidates: [...new Set(surfaceCandidates || [])],
            shapeDiagnostics: filtered.diagnostics,
            resolutionEquivalentGroups: collapsed.groups,
        });
    }

    resolveDecoratorKey(key: DecoratorKey): ApiIdentityResolution {
        if (!key.decoratorName) {
            return unresolved("decorator_key_incomplete", { key });
        }
        const candidates = this.byDecoratorKey.get(decoratorKeyString(key));
        return candidates
            ? unique(candidates, "decorator_key_exact", { key })
            : unresolved("decorator_key_not_registered", { key });
    }

    resolveProjectDeclarationKey(key: ProjectDeclarationKey): ApiIdentityResolution {
        const id = this.byProjectDeclarationKey.get(projectDeclarationKeyString(key));
        return id
            ? accepted(id, "project_declaration_key_exact", { key })
            : unresolved("project_declaration_key_not_registered", { key });
    }

    private filterImportMemberCandidatesByKnownShape(
        candidates: readonly string[],
        constraints: KnownShapeConstraints,
    ): ShapeFilterResult {
        const filtered: string[] = [];
        const diagnostics: ShapeFilterDiagnostics = {
            rejectedByParameterType: [],
            rejectedByReturnType: [],
            rejectedByObjectKeys: [],
            rejectedByLiteralKinds: [],
            rejectedByLiteralValues: [],
            rejectedBySpreadPositions: [],
            rejectedByCallbackPositions: [],
            missingShapeMetadata: [],
        };
        for (const candidate of [...new Set(candidates)]) {
            const descriptor = this.byId.get(candidate);
            if (!descriptor) continue;
            if (!this.descriptorMatchesKnownParameterTypes(descriptor, constraints)) {
                diagnostics.rejectedByParameterType.push(candidate);
                continue;
            }
            if (constraints.returnType && !typeTextsMatchConstraint(descriptor.signature.returnType.text, constraints.returnType)) {
                diagnostics.rejectedByReturnType.push(candidate);
                continue;
            }
            if (!this.descriptorMatchesLiteralValues(descriptor, constraints, diagnostics)) continue;
            if (!this.descriptorMatchesSpreadPositions(descriptor, constraints, diagnostics)) continue;
            if (!this.descriptorMatchesCallbackPositions(descriptor, constraints, diagnostics)) continue;
            if (!this.descriptorMatchesObjectKeys(descriptor, constraints, diagnostics)) continue;
            if (!this.descriptorMatchesLiteralKinds(descriptor, constraints, diagnostics)) continue;
            filtered.push(candidate);
        }
        return { candidates: filtered, diagnostics };
    }

    private descriptorMatchesKnownParameterTypes(
        descriptor: CanonicalApiDescriptor,
        constraints: KnownShapeConstraints,
    ): boolean {
        for (const constraint of constraints.parameterTypes) {
            const declaredTypes = declaredTypeConstraintsForObservedParameter(descriptor, constraint.index);
            if (declaredTypes.length === 0) return false;
            if (declaredTypes.some(declaredType => typeTextsMatchConstraint(declaredType, constraint.type))) {
                continue;
            }

            const observedLiteralKind = primitiveLiteralKindForTypeText(constraint.type);
            const parameter = descriptorParameterForObservedIndex(descriptor, constraint.index);
            const shape = parameter
                ? this.declarationShapeIndex.getParameterShape(descriptor.canonicalApiId, parameter.index)
                : undefined;
            if (observedLiteralKind && shape?.acceptsLiteralKinds.includes(observedLiteralKind)) {
                continue;
            }

            return false;
        }
        return true;
    }

    private descriptorMatchesObjectKeys(
        descriptor: CanonicalApiDescriptor,
        constraints: KnownShapeConstraints,
        diagnostics: ShapeFilterDiagnostics,
    ): boolean {
        for (const constraint of constraints.objectKeys) {
            const shape = this.declarationShapeIndex.getParameterShape(descriptor.canonicalApiId, constraint.index);
            if (!shape?.objectPropertyNames) {
                if (shape && shapeHasKnownNonObjectLiteralKind(shape)) {
                    diagnostics.rejectedByObjectKeys.push({
                        canonicalApiId: descriptor.canonicalApiId,
                        parameterIndex: constraint.index,
                        observedKeys: constraint.keys,
                        declaredKeys: shape.objectPropertyNames || [],
                    });
                    return false;
                }
                diagnostics.missingShapeMetadata.push({
                    canonicalApiId: descriptor.canonicalApiId,
                    parameterIndex: constraint.index,
                    kind: "objectKeys",
                });
                continue;
            }
            const declared = new Set(shape.objectPropertyNames);
            if (!constraint.keys.every(key => declared.has(key))) {
                diagnostics.rejectedByObjectKeys.push({
                    canonicalApiId: descriptor.canonicalApiId,
                    parameterIndex: constraint.index,
                    observedKeys: constraint.keys,
                    declaredKeys: shape.objectPropertyNames,
                });
                return false;
            }
        }
        return true;
    }

    private descriptorMatchesLiteralKinds(
        descriptor: CanonicalApiDescriptor,
        constraints: KnownShapeConstraints,
        diagnostics: ShapeFilterDiagnostics,
    ): boolean {
        for (const constraint of constraints.literalKinds) {
            const shape = this.declarationShapeIndex.getParameterShape(descriptor.canonicalApiId, constraint.index);
            if (!shape) {
                diagnostics.missingShapeMetadata.push({
                    canonicalApiId: descriptor.canonicalApiId,
                    parameterIndex: constraint.index,
                    kind: "literalKind",
                });
                continue;
            }
            if (shapeAcceptsLiteralKind(shape, constraint.kind)) continue;
            if (shape.metadataSource === "type-text" && shape.acceptsLiteralKinds.length === 0) {
                diagnostics.missingShapeMetadata.push({
                    canonicalApiId: descriptor.canonicalApiId,
                    parameterIndex: constraint.index,
                    kind: "literalKind",
                });
                continue;
            }
            diagnostics.rejectedByLiteralKinds.push({
                canonicalApiId: descriptor.canonicalApiId,
                parameterIndex: constraint.index,
                observedKind: constraint.kind,
                acceptedKinds: shape.acceptsLiteralKinds,
            });
            return false;
        }
        return true;
    }

    private descriptorMatchesLiteralValues(
        descriptor: CanonicalApiDescriptor,
        constraints: KnownShapeConstraints,
        diagnostics: ShapeFilterDiagnostics,
    ): boolean {
        for (const constraint of constraints.literalValues) {
            const parameter = descriptorParameterForObservedIndex(descriptor, constraint.index);
            const acceptedValues = literalValuesForTypeText(parameter?.type.text || "");
            if (acceptedValues.length === 0) {
                diagnostics.missingShapeMetadata.push({
                    canonicalApiId: descriptor.canonicalApiId,
                    parameterIndex: constraint.index,
                    kind: "literalValue",
                });
                continue;
            }
            if (acceptedValues.some(value => literalValuesEqual(value, constraint.value))) continue;
            diagnostics.rejectedByLiteralValues.push({
                canonicalApiId: descriptor.canonicalApiId,
                parameterIndex: constraint.index,
                observedValue: constraint.value,
                acceptedValues,
            });
            return false;
        }
        return true;
    }

    private descriptorMatchesSpreadPositions(
        descriptor: CanonicalApiDescriptor,
        constraints: KnownShapeConstraints,
        diagnostics: ShapeFilterDiagnostics,
    ): boolean {
        for (const index of constraints.spreadPositions) {
            const parameter = descriptorParameterForObservedIndex(descriptor, index);
            const rest = restParameterForDescriptor(descriptor);
            if (parameter?.rest) continue;
            if (parameter && isArrayLikeTypeText(parameter.type.text)) continue;
            if (rest && index >= rest.index) continue;
            diagnostics.rejectedBySpreadPositions.push({
                canonicalApiId: descriptor.canonicalApiId,
                parameterIndex: index,
                declaredType: parameter?.type.text || "",
            });
            return false;
        }
        return true;
    }

    private descriptorMatchesCallbackPositions(
        descriptor: CanonicalApiDescriptor,
        constraints: KnownShapeConstraints,
        diagnostics: ShapeFilterDiagnostics,
    ): boolean {
        for (const index of constraints.callbackPositions) {
            const shape = this.declarationShapeIndex.getParameterShape(descriptor.canonicalApiId, index);
            if (shape?.callbackLike) continue;
            const typeText = descriptor.signature.parameters[index]?.type.text || "";
            if (!shape && isCallbackLikeTypeText(typeText)) continue;
            diagnostics.rejectedByCallbackPositions.push({
                canonicalApiId: descriptor.canonicalApiId,
                parameterIndex: index,
                declaredType: typeText,
            });
            return false;
        }
        return true;
    }

    private collapseResolutionEquivalentCandidates(
        candidates: readonly string[],
    ): ResolutionEquivalentCandidateCollapse {
        const descriptorsByKey = new Map<string, CanonicalApiDescriptor[]>();
        const descriptorById = new Map<string, CanonicalApiDescriptor>();
        const unknownCandidateIds: string[] = [];
        for (const candidate of [...new Set(candidates)]) {
            const descriptor = this.byId.get(candidate);
            if (!descriptor) {
                unknownCandidateIds.push(candidate);
                continue;
            }
            descriptorById.set(candidate, descriptor);
            const key = canonicalApiDescriptorResolutionEquivalenceKey(descriptor);
            const group = descriptorsByKey.get(key) || [];
            group.push(descriptor);
            descriptorsByKey.set(key, group);
        }

        const representativeById = new Map<string, string>();
        const groups: ResolutionEquivalentCandidateGroup[] = [];
        for (const [equivalenceKey, descriptors] of descriptorsByKey) {
            if (!isCanonicalApiDescriptorResolutionMirrorGroup(descriptors)) continue;
            const sorted = descriptors.slice().sort(compareCanonicalApiDescriptorForRepresentative);
            const representative = sorted[0].canonicalApiId;
            const canonicalApiIds = sorted.map(descriptor => descriptor.canonicalApiId);
            for (const id of canonicalApiIds) {
                representativeById.set(id, representative);
            }
            groups.push({
                equivalenceKey,
                representativeCanonicalApiId: representative,
                canonicalApiIds,
                declarationFiles: uniqueSorted(sorted.map(descriptor => descriptor.logicalDeclarationFile)),
            });
        }

        const collapsed: string[] = [];
        for (const candidate of [...new Set(candidates)]) {
            const descriptor = descriptorById.get(candidate);
            if (!descriptor) continue;
            const id = representativeById.get(candidate) || candidate;
            if (!collapsed.includes(id)) collapsed.push(id);
        }
        for (const candidate of unknownCandidateIds) {
            if (!collapsed.includes(candidate)) collapsed.push(candidate);
        }
        return {
            candidates: collapsed,
            groups: groups.sort((left, right) => left.representativeCanonicalApiId.localeCompare(right.representativeCanonicalApiId)),
        };
    }
}

export function createCanonicalApiRegistry(descriptors: readonly CanonicalApiDescriptor[] = []): CanonicalApiRegistry {
    return new CanonicalApiRegistry(descriptors);
}

function accepted(id: string, reason: string, data: Record<string, unknown>): ApiIdentityResolution {
    return {
        status: "accepted",
        canonicalApiId: id,
        reason,
        evidence: [{ kind: reason, message: reason, data }],
    };
}

function unresolved(reason: string, data: Record<string, unknown>): ApiIdentityResolution {
    return {
        status: "unresolved",
        reason,
        evidence: [{ kind: reason, message: reason, data }],
    };
}

function rejected(reason: string, data: Record<string, unknown>): ApiIdentityResolution {
    return {
        status: "rejected",
        reason,
        evidence: [{ kind: reason, message: reason, data }],
    };
}

function unique(candidates: string[], reason: string, data: Record<string, unknown>): ApiIdentityResolution {
    const uniqueCandidates = [...new Set(candidates)];
    if (uniqueCandidates.length === 1) return accepted(uniqueCandidates[0], reason, data);
    if (uniqueCandidates.length === 0) return unresolved(`${reason}_no_candidate`, data);
    return {
        status: "ambiguous",
        candidates: uniqueCandidates,
        reason: `${reason}_ambiguous`,
        evidence: [{ kind: `${reason}_ambiguous`, message: `${reason}_ambiguous`, data }],
    };
}

function resolveImportMemberCandidateSet(candidates: string[], data: Record<string, unknown>): ApiIdentityResolution {
    const uniqueCandidates = [...new Set(candidates)];
    if (uniqueCandidates.length === 1) return accepted(uniqueCandidates[0], "import_member_candidate_exact_unique", data);
    if (uniqueCandidates.length === 0) return unresolved("import_member_shape_constraints_no_candidate", data);
    const diagnostics = data.shapeDiagnostics as ShapeFilterDiagnostics | undefined;
    const reason = diagnostics?.missingShapeMetadata.length
        ? "import_member_candidate_missing_shape_metadata"
        : "import_member_candidate_exact_ambiguous";
    return {
        status: "ambiguous",
        candidates: uniqueCandidates,
        reason,
        evidence: [{ kind: reason, message: reason, data }],
    };
}

function resolveReceiverMemberCandidateSet(candidates: string[], data: Record<string, unknown>): ApiIdentityResolution {
    const uniqueCandidates = [...new Set(candidates)];
    if (uniqueCandidates.length === 1) return accepted(uniqueCandidates[0], "receiver_member_candidate_exact_unique", data);
    if (uniqueCandidates.length === 0) return unresolved("receiver_member_shape_constraints_no_candidate", data);
    const diagnostics = data.shapeDiagnostics as ShapeFilterDiagnostics | undefined;
    const reason = diagnostics?.missingShapeMetadata.length
        ? "receiver_member_candidate_missing_shape_metadata"
        : "receiver_member_candidate_exact_ambiguous";
    return {
        status: "ambiguous",
        candidates: uniqueCandidates,
        reason,
        evidence: [{ kind: reason, message: reason, data }],
    };
}

function receiverMemberCandidateKeysFromReceiverMemberKey(
    key: ReceiverMemberKey,
    receiverTypes: readonly string[],
): ReceiverMemberCandidateKey[] {
    return uniqueReceiverTypes(receiverTypes).map(receiverType => ({
        moduleSpecifier: key.moduleSpecifier,
        receiverType,
        memberName: key.memberName,
        invokeKind: key.invokeKind,
        arity: key.argShape.arity,
    }));
}

function receiverMemberSurfaceKeysFromReceiverMemberKey(
    key: ReceiverMemberKey,
    receiverTypes: readonly string[],
): ReceiverMemberSurfaceKey[] {
    return uniqueReceiverTypes(receiverTypes).map(receiverType => ({
        moduleSpecifier: key.moduleSpecifier,
        receiverType,
        memberName: key.memberName,
        invokeKind: key.invokeKind,
    }));
}

function uniqueReceiverTypes(receiverTypes: readonly string[]): string[] {
    return [...new Set(receiverTypes.map(type => String(type || "").trim()).filter(Boolean))];
}

function uniqueSorted(values: readonly string[]): string[] {
    return [...new Set(values.map(value => String(value || "").trim()).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right));
}

function resolveArkUiComponentCandidateSet(candidates: string[], data: Record<string, unknown>): ApiIdentityResolution {
    const uniqueCandidates = [...new Set(candidates)];
    if (uniqueCandidates.length === 1) return accepted(uniqueCandidates[0], "arkui_component_candidate_exact_unique", data);
    if (uniqueCandidates.length === 0) return unresolved("arkui_component_shape_constraints_no_candidate", data);
    const diagnostics = data.shapeDiagnostics as ShapeFilterDiagnostics | undefined;
    const reason = diagnostics?.missingShapeMetadata.length
        ? "arkui_component_candidate_missing_shape_metadata"
        : "arkui_component_candidate_exact_ambiguous";
    return {
        status: "ambiguous",
        candidates: uniqueCandidates,
        reason,
        evidence: [{ kind: reason, message: reason, data }],
    };
}

interface ShapeFilterResult {
    candidates: string[];
    diagnostics: ShapeFilterDiagnostics;
}

interface ResolutionEquivalentCandidateCollapse {
    candidates: string[];
    groups: ResolutionEquivalentCandidateGroup[];
}

interface ResolutionEquivalentCandidateGroup {
    equivalenceKey: string;
    representativeCanonicalApiId: string;
    canonicalApiIds: string[];
    declarationFiles: string[];
}

interface ShapeFilterDiagnostics {
    rejectedByParameterType: string[];
    rejectedByReturnType: string[];
    rejectedByObjectKeys: Array<{
        canonicalApiId: string;
        parameterIndex: number;
        observedKeys: string[];
        declaredKeys: string[];
    }>;
    rejectedByLiteralKinds: Array<{
        canonicalApiId: string;
        parameterIndex: number;
        observedKind: string;
        acceptedKinds: string[];
    }>;
    rejectedByCallbackPositions: Array<{
        canonicalApiId: string;
        parameterIndex: number;
        declaredType: string;
    }>;
    rejectedByLiteralValues: Array<{
        canonicalApiId: string;
        parameterIndex: number;
        observedValue: string | number | boolean | null;
        acceptedValues: Array<string | number | boolean | null>;
    }>;
    rejectedBySpreadPositions: Array<{
        canonicalApiId: string;
        parameterIndex: number;
        declaredType: string;
    }>;
    missingShapeMetadata: Array<{
        canonicalApiId: string;
        parameterIndex: number;
        kind: "objectKeys" | "literalKind" | "literalValue";
    }>;
}

function appendIndex(map: Map<string, string[]>, key: string, id: string): void {
    const current = map.get(key) || [];
    if (!current.includes(id)) current.push(id);
    map.set(key, current);
}

function acceptedAritiesForDescriptor(descriptor: CanonicalApiDescriptor): number[] {
    if (descriptor.invoke.kind === "property-write" && descriptor.signature.parameters.length === 0) {
        return [1];
    }
    const parameters = descriptor.signature.parameters;
    const requiredCount = parameters.filter(parameter => !parameter.optional && !parameter.rest).length;
    const maxCount = parameters.length;
    const out: number[] = [];
    for (let arity = requiredCount; arity <= maxCount; arity++) {
        out.push(arity);
    }
    return out.length > 0 ? out : [0];
}

function setUniqueIndex(map: Map<string, string>, key: string, id: string, label: string): void {
    const existing = map.get(key);
    if (existing && existing !== id) {
        throw new Error(`canonical registry ${label} collision: ${JSON.stringify({ key, existing, next: id })}`);
    }
    map.set(key, id);
}

function importKeysForDescriptor(descriptor: CanonicalApiDescriptor): string[] {
    const keys = new Set<string>();
    for (const importKind of importKindsForDescriptor(descriptor)) {
        for (const importedName of importedNamesForDescriptor(descriptor, importKind)) {
            for (const memberChain of memberChainsForDescriptor(descriptor, importKind, importedName)) {
                keys.add(importMemberKeyString({
                    moduleSpecifier: descriptor.moduleSpecifier,
                    importKind,
                    importedName,
                    localBindingId: "<registry>",
                    localName: importedName,
                    aliasChain: [],
                    memberChain,
                    invokeKind: invokeKindForDescriptor(descriptor),
                    argShape: {
                        arity: descriptor.signature.parameters.length,
                        parameterTypes: descriptor.signature.parameters.map(param => param.type.text),
                        returnType: descriptor.signature.returnType.text,
                    },
                    scopeEvidence: {
                        sourceFile: "",
                        enclosingMethodSignature: "",
                        shadowed: false,
                    },
                }));
            }
        }
    }
    return [...keys];
}

function importCandidateKeysForDescriptor(descriptor: CanonicalApiDescriptor): string[] {
    const keys = new Set<string>();
    for (const importKind of importKindsForDescriptor(descriptor)) {
        for (const importedName of importedNamesForDescriptor(descriptor, importKind)) {
            for (const memberChain of memberChainsForDescriptor(descriptor, importKind, importedName)) {
                for (const arity of acceptedAritiesForDescriptor(descriptor)) {
                    keys.add(importMemberCandidateKeyString({
                        moduleSpecifier: descriptor.moduleSpecifier,
                        importKind,
                        importedName,
                        memberChain,
                        invokeKind: invokeKindForDescriptor(descriptor),
                        arity,
                    }));
                }
            }
        }
    }
    return [...keys];
}

function importSurfaceKeysForDescriptor(descriptor: CanonicalApiDescriptor): string[] {
    const keys = new Set<string>();
    for (const importKind of importKindsForDescriptor(descriptor)) {
        for (const importedName of importedNamesForDescriptor(descriptor, importKind)) {
            for (const memberChain of memberChainsForDescriptor(descriptor, importKind, importedName)) {
                const key: ImportMemberSurfaceKey = {
                    moduleSpecifier: descriptor.moduleSpecifier,
                    importKind,
                    importedName,
                    memberChain,
                    invokeKind: invokeKindForDescriptor(descriptor),
                };
                keys.add(importMemberSurfaceKeyString(key));
            }
        }
    }
    return [...keys];
}

function receiverCandidateKeysForDescriptor(descriptor: CanonicalApiDescriptor): string[] {
    if (!descriptorMemberCanUseReceiver(descriptor)) return [];
    const keys = new Set<string>();
    for (const receiverType of receiverTypesForDescriptor(descriptor)) {
        for (const arity of acceptedAritiesForDescriptor(descriptor)) {
            const key: ReceiverMemberCandidateKey = {
                moduleSpecifier: descriptor.moduleSpecifier,
                receiverType,
                memberName: descriptor.member.name,
                invokeKind: receiverInvokeKindForDescriptor(descriptor),
                arity,
            };
            keys.add(receiverMemberCandidateKeyString(key));
        }
    }
    return [...keys];
}

function receiverSurfaceKeysForDescriptor(descriptor: CanonicalApiDescriptor): string[] {
    if (!descriptorMemberCanUseReceiver(descriptor)) return [];
    const keys = new Set<string>();
    for (const receiverType of receiverTypesForDescriptor(descriptor)) {
        const key: ReceiverMemberSurfaceKey = {
            moduleSpecifier: descriptor.moduleSpecifier,
            receiverType,
            memberName: descriptor.member.name,
            invokeKind: receiverInvokeKindForDescriptor(descriptor),
        };
        keys.add(receiverMemberSurfaceKeyString(key));
    }
    return [...keys];
}

function descriptorMemberCanUseReceiver(descriptor: CanonicalApiDescriptor): boolean {
    if (descriptor.declarationOwner.kind !== "class" && descriptor.declarationOwner.kind !== "interface") {
        return false;
    }
    if (descriptor.member.kind === "method") return descriptor.member.static === false;
    return descriptor.member.kind === "getter"
        || descriptor.member.kind === "setter"
        || descriptor.member.kind === "property";
}

function receiverInvokeKindForDescriptor(descriptor: CanonicalApiDescriptor): ReceiverMemberCandidateKey["invokeKind"] {
    if (descriptor.invoke.kind === "property-read") return "property-read";
    if (descriptor.invoke.kind === "property-write") return "property-write";
    return "call";
}

function receiverTypesForDescriptor(descriptor: CanonicalApiDescriptor): string[] {
    const out = new Set<string>();
    for (const candidate of receiverTypeCandidates(descriptor.declarationOwner.normalizedName)) {
        out.add(candidate);
    }
    for (const candidate of receiverTypeCandidates(descriptor.declarationOwner.path.join("."))) {
        out.add(candidate);
    }
    return [...out];
}

function filterCandidatesByAcceptedArity(
    candidates: readonly string[],
    arity: number,
    byId: ReadonlyMap<string, CanonicalApiDescriptor>,
): string[] {
    return [...new Set(candidates)].filter(candidate => {
        const descriptor = byId.get(candidate);
        return descriptor ? descriptorAcceptsArity(descriptor, arity) : false;
    });
}

function descriptorAcceptsArity(descriptor: CanonicalApiDescriptor, arity: number): boolean {
    if (!Number.isInteger(arity) || arity < 0) return false;
    if (descriptor.invoke.kind === "property-write" && descriptor.signature.parameters.length === 0) {
        return arity === 1;
    }
    const parameters = descriptor.signature.parameters;
    const requiredCount = parameters.filter(parameter => !parameter.optional && !parameter.rest).length;
    const rest = restParameterForDescriptor(descriptor);
    if (arity < requiredCount) return false;
    if (rest) return arity >= requiredCount;
    return arity <= parameters.length;
}

function descriptorParameterForObservedIndex(
    descriptor: CanonicalApiDescriptor,
    index: number,
): CanonicalApiDescriptor["signature"]["parameters"][number] | undefined {
    const direct = descriptor.signature.parameters[index];
    if (direct) return direct;
    const rest = restParameterForDescriptor(descriptor);
    if (rest && index >= rest.index) return rest;
    return undefined;
}

function declaredTypeConstraintsForObservedParameter(descriptor: CanonicalApiDescriptor, index: number): string[] {
    if (descriptor.invoke.kind === "property-write" && descriptor.signature.parameters.length === 0 && index === 0) {
        return [descriptor.signature.returnType.text].filter(Boolean);
    }
    const parameter = descriptorParameterForObservedIndex(descriptor, index);
    if (!parameter) return [];
    const out = new Set<string>();
    out.add(parameter.type.text);
    if (parameter.rest) {
        const elementType = arrayElementTypeText(parameter.type.text);
        if (elementType) out.add(elementType);
    }
    return [...out].filter(Boolean);
}

function restParameterForDescriptor(
    descriptor: CanonicalApiDescriptor,
): CanonicalApiDescriptor["signature"]["parameters"][number] | undefined {
    return descriptor.signature.parameters.find(parameter => parameter.rest);
}

function arrayElementTypeText(value: string): string | undefined {
    const text = normalizeComparableTypeText(value);
    if (text.endsWith("[]")) return text.slice(0, -2);
    const match = /^Array<(.+)>$/.exec(text);
    return match?.[1];
}

function typeTextsMatchConstraint(declaredType: string, observedType: string): boolean {
    const declared = normalizeComparableTypeText(declaredType);
    const observed = normalizeComparableTypeText(observedType);
    if (!declared || !observed) return false;
    if (declared === "any") return true;
    const declaredArrayElement = arrayElementTypeText(declared);
    const observedArrayElement = arrayElementTypeText(observed);
    if (declaredArrayElement === "any" && !!observedArrayElement) return true;
    if (declared === observed) return true;
    const declaredWithoutQualifiers = stripTypeQualifierPrefixes(declared);
    const observedWithoutQualifiers = stripTypeQualifierPrefixes(observed);
    if (declaredWithoutQualifiers === observedWithoutQualifiers) return true;
    if (nonNullableComparableTypeText(declared) === observed) return true;
    if (stripTypeQualifierPrefixes(nonNullableComparableTypeText(declared)) === observedWithoutQualifiers) return true;
    if (declared === nonNullableComparableTypeText(observed)) return true;
    if (declaredWithoutQualifiers === stripTypeQualifierPrefixes(nonNullableComparableTypeText(observed))) return true;
    if (genericTypeTextsMatch(declared, observed)) return true;
    return topLevelUnionParts(declared).some(part => {
        const normalizedPart = normalizeComparableTypeText(part);
        if (isNullishTypeText(normalizedPart)) return false;
        return normalizedPart === observed
            || stripTypeQualifierPrefixes(normalizedPart) === observedWithoutQualifiers
            || nonNullableComparableTypeText(normalizedPart) === observed
            || stripTypeQualifierPrefixes(nonNullableComparableTypeText(normalizedPart)) === observedWithoutQualifiers;
    });
}

function genericTypeTextsMatch(declaredType: string, observedType: string): boolean {
    const declared = genericTypeParts(declaredType);
    const observed = genericTypeParts(observedType);
    if (!declared || !observed) return false;
    if (stripTypeQualifierPrefixes(declared.base) !== stripTypeQualifierPrefixes(observed.base)) return false;
    if (declared.args.length !== observed.args.length) return false;
    return declared.args.every((arg, index) => typeTextsMatchConstraint(arg, observed.args[index]));
}

function genericTypeParts(value: string): { base: string; args: string[] } | undefined {
    const text = normalizeComparableTypeText(value);
    const start = text.indexOf("<");
    if (start <= 0 || !text.endsWith(">")) return undefined;
    const base = text.slice(0, start);
    const body = text.slice(start + 1, -1);
    return { base, args: topLevelGenericArgs(body) };
}

function topLevelGenericArgs(value: string): string[] {
    const text = normalizeComparableTypeText(value);
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let index = 0; index < text.length; index++) {
        const char = text[index];
        if (char === "<" || char === "(" || char === "[") depth++;
        if ((char === ">" || char === ")" || char === "]") && depth > 0) depth--;
        if (char === "," && depth === 0) {
            parts.push(text.slice(start, index));
            start = index + 1;
        }
    }
    parts.push(text.slice(start));
    return parts.map(part => part.trim()).filter(Boolean);
}

function literalValuesForTypeText(value: string): Array<string | number | boolean | null> {
    const values: Array<string | number | boolean | null> = [];
    for (const part of topLevelUnionParts(value)) {
        const text = normalizeComparableTypeText(part);
        const stringMatch = /^['"]([^'"]*)['"]$/.exec(text);
        if (stringMatch) {
            values.push(stringMatch[1]);
            continue;
        }
        if (text === "true") {
            values.push(true);
            continue;
        }
        if (text === "false") {
            values.push(false);
            continue;
        }
        if (text === "null") {
            values.push(null);
            continue;
        }
        if (/^-?\d+(?:\.\d+)?$/.test(text)) {
            values.push(Number(text));
        }
    }
    return values;
}

function literalValuesEqual(left: string | number | boolean | null, right: string | number | boolean | null): boolean {
    return left === right;
}

function isArrayLikeTypeText(value: string): boolean {
    const text = normalizeComparableTypeText(value);
    return /\bArray\s*</.test(text) || /\[\]\s*$/.test(text);
}

function normalizeComparableTypeText(value: string): string {
    const compact = String(value || "")
        .replace(/\s+/g, " ")
        .replace(/\s*([<>,|&()[\]])\s*/g, "$1")
        .trim();
    return stripDeclarationTypePrefixes(compact)
        .replace(/^@ohos\./, "")
        .trim();
}

function nonNullableComparableTypeText(value: string): string {
    const text = normalizeComparableTypeText(value).replace(/^\?/, "");
    const parts = topLevelUnionParts(text).filter(part => !isNullishTypeText(part));
    return parts.length === 1 ? parts[0] : text;
}

function isNullishTypeText(value: string): boolean {
    const text = normalizeComparableTypeText(value).toLowerCase();
    return text === "undefined" || text === "null" || text === "void" || text === "never";
}

function stripTypeQualifierPrefixes(value: string): string {
    return normalizeComparableTypeText(value).replace(
        /\b[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)+\b/g,
        match => match.split(".").pop() || match,
    );
}

function stripDeclarationTypePrefixes(value: string): string {
    return value
        .replace(/(^|[<>,|&()[\]])@[^:|&<>,()[\]]+:\s*/g, "$1")
        .replace(/(^|[<>,|&()[\]])[^:|&<>,()[\]]+\.d\.(?:ts|ets):\s*/g, "$1");
}

function primitiveLiteralKindForTypeText(value: string): string | undefined {
    const text = normalizeComparableTypeText(value);
    if (text === "string") return "string";
    if (text === "number") return "number";
    if (text === "boolean") return "boolean";
    return undefined;
}

function topLevelUnionParts(value: string): string[] {
    const text = normalizeComparableTypeText(value);
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let index = 0; index < text.length; index++) {
        const char = text[index];
        if (char === "<" || char === "(" || char === "[") depth++;
        if ((char === ">" || char === ")" || char === "]") && depth > 0) depth--;
        if (char === "|" && depth === 0) {
            parts.push(text.slice(start, index));
            start = index + 1;
        }
    }
    parts.push(text.slice(start));
    return parts.map(part => part.trim()).filter(Boolean);
}

function isCallbackLikeTypeText(value: string): boolean {
    const text = String(value || "");
    return /\b(callback|function)\b/i.test(text)
        || /\b[A-Za-z_$][A-Za-z0-9_$]*Callback\b/.test(text)
        || text.includes("=>")
        || /^Function\b/.test(text)
        || /\([^)]*\)\s*=>/.test(text);
}

function shapeAcceptsLiteralKind(
    shape: NonNullable<ReturnType<DeclarationShapeIndex["getParameterShape"]>>,
    kind: string,
): boolean {
    if (shape.acceptsLiteralKinds.includes(kind)) return true;
    if (kind === "object" && shape.objectPropertyNames && shape.objectPropertyNames.length > 0) return true;
    if (kind === "function" && shape.callbackLike) return true;
    if (kind === "array" && shape.arrayLike) return true;
    return false;
}

function shapeHasKnownNonObjectLiteralKind(
    shape: NonNullable<ReturnType<DeclarationShapeIndex["getParameterShape"]>>,
): boolean {
    if (shape.callbackLike || shape.arrayLike || shape.promiseLike) return true;
    const accepted = new Set(shape.acceptsLiteralKinds);
    if (accepted.size === 0) return false;
    return !accepted.has("object");
}

function importedNameForDescriptor(descriptor: CanonicalApiDescriptor): string {
    const first = descriptor.exportPath[0];
    return first?.name || descriptor.declarationOwner.normalizedName || descriptor.member.name;
}

function importKindsForDescriptor(descriptor: CanonicalApiDescriptor): Array<Extract<ImportMemberKey["importKind"], "default" | "namespace" | "named">> {
    const kinds = new Set<Extract<ImportMemberKey["importKind"], "default" | "namespace" | "named">>();
    for (const exportPart of descriptor.exportPath) {
        if (exportPart.kind === "default") kinds.add("default");
        if (exportPart.kind === "namespace") {
            kinds.add("namespace");
            kinds.add("default");
        }
        if (exportPart.kind === "named") {
            kinds.add("named");
            kinds.add("namespace");
        }
    }
    if (kinds.size === 0) {
        kinds.add(descriptor.member.kind === "function" ? "named" : "namespace");
    }
    return [...kinds];
}

function importedNamesForDescriptor(
    descriptor: CanonicalApiDescriptor,
    importKind: Extract<ImportMemberKey["importKind"], "default" | "namespace" | "named">,
): string[] {
    const names = new Set<string>();
    if (importKind === "default") {
        names.add("default");
        names.add("%dflt");
        return [...names];
    }
    if (importKind === "namespace") {
        names.add("*");
        names.add(importedNameForDescriptor(descriptor));
        names.add(descriptor.declarationOwner.normalizedName);
        return [...names].filter(Boolean);
    }
    names.add(descriptor.member.name);
    names.add(importedNameForDescriptor(descriptor));
    const namedExport = descriptor.exportPath.find(part => part.kind === "named");
    if (namedExport?.name) names.add(namedExport.name);
    return [...names].filter(Boolean);
}

function invokeKindForDescriptor(descriptor: CanonicalApiDescriptor): ImportMemberKey["invokeKind"] {
    if (descriptor.invoke.kind === "new") return "new";
    if (descriptor.invoke.kind === "property-read") return "property-read";
    if (descriptor.invoke.kind === "property-write") return "property-write";
    return "call";
}

function memberChainsForDescriptor(
    descriptor: CanonicalApiDescriptor,
    importKind: Extract<ImportMemberKey["importKind"], "default" | "namespace" | "named">,
    importedName: string,
): string[][] {
    const memberName = descriptor.member.kind === "constructor"
        ? "constructor"
        : descriptor.member.name;
    const ownerChain = relativeOwnerChainForImport(descriptor, importKind, importedName);
    const chains = new Set<string>();

    if (ownerChain.length > 0) {
        addMemberChain(chains, [...ownerChain, memberName]);
        if (descriptor.member.kind === "constructor") {
            addMemberChain(chains, ownerChain);
        }
    } else {
        addMemberChain(chains, [memberName]);
    }

    return [...chains]
        .map(value => value.split(".").filter(Boolean))
        .filter(chain => chain.length > 0);
}

function relativeOwnerChainForImport(
    descriptor: CanonicalApiDescriptor,
    importKind: Extract<ImportMemberKey["importKind"], "default" | "namespace" | "named">,
    importedName: string,
): string[] {
    if (descriptor.declarationOwner.kind === "file") return [];
    if (descriptor.declarationOwner.kind === "function") {
        const owner = descriptor.declarationOwner.path[descriptor.declarationOwner.path.length - 1] || "";
        return owner === descriptor.member.name ? [] : ownerPathSegments(descriptor.declarationOwner.path);
    }

    const ownerPath = ownerPathSegments(descriptor.declarationOwner.path);
    if (ownerPath.length === 0) return [];
    const rootCandidates = importRootCandidates(descriptor, importKind, importedName);
    for (const candidate of rootCandidates) {
        const stripped = stripPrefix(ownerPath, candidate);
        if (stripped.length !== ownerPath.length) return stripped;
    }
    return ownerPath;
}

function importRootCandidates(
    descriptor: CanonicalApiDescriptor,
    importKind: Extract<ImportMemberKey["importKind"], "default" | "namespace" | "named">,
    importedName: string,
): string[][] {
    const candidates: string[][] = [];
    const push = (value: string | undefined): void => {
        const segments = ownerPathSegments(String(value || "").split("."));
        if (segments.length > 0 && !candidates.some(item => sameStringArray(item, segments))) {
            candidates.push(segments);
        }
    };

    if (importKind === "named") {
        push(importedName);
    }

    if (importKind === "default") {
        for (const part of descriptor.exportPath) {
            if (part.kind === "default") push(part.name);
            if (part.kind === "namespace") push(firstPathSegment(part.name));
        }
    }

    if (importKind === "namespace") {
        for (const part of descriptor.exportPath) {
            if (part.kind === "namespace") push(firstPathSegment(part.name));
        }
    }

    return candidates;
}

function ownerPathSegments(values: readonly string[]): string[] {
    return values
        .flatMap(value => String(value || "").split("."))
        .map(value => value.trim())
        .filter(Boolean);
}

function firstPathSegment(value: string): string {
    return ownerPathSegments([value])[0] || "";
}

function stripPrefix(value: readonly string[], prefix: readonly string[]): string[] {
    if (prefix.length === 0 || prefix.length > value.length) return [...value];
    for (let index = 0; index < prefix.length; index++) {
        if (value[index] !== prefix[index]) return [...value];
    }
    return value.slice(prefix.length);
}

function addMemberChain(output: Set<string>, chain: readonly string[]): void {
    const normalized = chain.map(part => String(part || "").trim()).filter(Boolean);
    if (normalized.length > 0) output.add(normalized.join("."));
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

function arkUiKeyForDescriptor(descriptor: CanonicalApiDescriptor): string | undefined {
    const exportPart = descriptor.exportPath.find(part => part.kind === "component");
    const componentName = exportPart?.name || componentNameFromAttributeOwner(descriptor.declarationOwner.normalizedName);
    if (!componentName) return undefined;
    if (descriptor.member.kind !== "component-event") {
        if (descriptor.invoke.kind !== "call") return undefined;
        if (descriptor.member.kind !== "method" && descriptor.member.kind !== "function") return undefined;
    }
    return arkUiChainKeyString({
        componentName,
        attributeOwner: descriptor.declarationOwner.normalizedName,
        eventName: descriptor.member.name,
        callbackArgCount: descriptor.signature.parameters.length,
        sourceFile: "",
    });
}

function arkUiComponentCandidateKeysForDescriptor(descriptor: CanonicalApiDescriptor): string[] {
    const exportPart = descriptor.exportPath.find(part => part.kind === "component");
    if (!exportPart?.name) return [];
    if (descriptor.invoke.kind !== "call") return [];
    if (descriptor.member.kind !== "method" && descriptor.member.kind !== "function") return [];
    return acceptedAritiesForDescriptor(descriptor).map(arity => {
        const key: ArkUiComponentCandidateKey = {
            componentName: exportPart.name,
            memberName: descriptor.member.name,
            invokeKind: "call",
            arity,
        };
        return arkUiComponentCandidateKeyString(key);
    });
}

function arkUiComponentSurfaceKeysForDescriptor(descriptor: CanonicalApiDescriptor): string[] {
    const exportPart = descriptor.exportPath.find(part => part.kind === "component");
    if (!exportPart?.name) return [];
    if (descriptor.invoke.kind !== "call") return [];
    if (descriptor.member.kind !== "method" && descriptor.member.kind !== "function") return [];
    const key: ArkUiComponentSurfaceKey = {
        componentName: exportPart.name,
        memberName: descriptor.member.name,
        invokeKind: "call",
    };
    return [arkUiComponentSurfaceKeyString(key)];
}

function decoratorKeyForDescriptor(descriptor: CanonicalApiDescriptor): string | undefined {
    if (descriptor.invoke.kind !== "decorator") return undefined;
    if (descriptor.member.kind !== "decorator") return undefined;
    if (!descriptor.member.name) return undefined;
    return decoratorKeyString({ decoratorName: descriptor.member.name });
}

function componentNameFromAttributeOwner(owner: string): string | undefined {
    const text = String(owner || "");
    if (text.endsWith("Attribute") && text.length > "Attribute".length) {
        return text.slice(0, -"Attribute".length);
    }
    return undefined;
}

function projectKeyForDescriptor(descriptor: CanonicalApiDescriptor): string | undefined {
    if (descriptor.authority === "official") return undefined;
    return projectDeclarationKeyString({
        file: descriptor.logicalDeclarationFile,
        exportPath: descriptor.exportPath.map(part => `${part.kind}:${part.name}`),
        ownerPath: descriptor.declarationOwner.path,
        memberName: descriptor.member.kind === "constructor" ? "constructor" : descriptor.member.name,
        parameterTypes: descriptor.signature.parameters.map(parameter => parameter.type.text),
        returnType: descriptor.signature.returnType.text,
    });
}
