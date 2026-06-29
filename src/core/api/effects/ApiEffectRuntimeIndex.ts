import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { ArkAssignStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkInstanceFieldRef, ArkParameterRef } from "../../../../arkanalyzer/out/src/core/base/Ref";
import { ArkAwaitExpr, ArkInstanceInvokeExpr, ArkNewArrayExpr, ArkNewExpr, ArkPtrInvokeExpr, ArkStaticInvokeExpr } from "../../../../arkanalyzer/out/src/core/base/Expr";
import { BooleanConstant, NullConstant, NumberConstant, StringConstant, UndefinedConstant } from "../../../../arkanalyzer/out/src/core/base/Constant";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import { ArrayType, ClassType, FunctionType } from "../../../../arkanalyzer/out/src/core/base/Type";
import { ArkMethod } from "../../../../arkanalyzer/out/src/core/model/ArkMethod";
import { ClassCategory } from "../../../../arkanalyzer/out/src/core/model/ArkClass";
import type { CanonicalApiDescriptor, CanonicalApiRegistry, ReceiverMemberKey } from "../identity";
import type { ImportMemberKey } from "../identity/ImportMemberKey";
import { ApiOccurrenceResolver } from "../occurrence";
import type { RawApiOccurrence, ResolvedApiOccurrence } from "../occurrence";
import {
    buildOfficialOccurrenceRecords,
    emptyOfficialOccurrenceCoverageSnapshot,
    summarizeOfficialOccurrenceCoverage,
    type OfficialOccurrenceCoverageSnapshot,
    type OfficialOccurrenceRecord,
} from "../occurrence";
import { projectBindingToEffect } from "./BindingProjector";
import type {
    AssetBinding,
    AssetDocumentBase,
    AssetEndpoint,
    AssetIdentityIndex,
    SemanticEffectTemplate,
} from "../../assets/schema";
import {
    isTrustedAnalysisAssetStatus,
} from "../../assets/schema";
import type {
    ApiEffectIdentity,
    ApiEffectInstance,
    ApiEffectRole,
    ApiIdentityBackedRule,
} from "../ApiOccurrenceIdentity";
import { hasApiEffectIdentity } from "../ApiOccurrenceIdentity";
import { semanticEffectSitesFromEffect, type SemanticEffectSite } from "./SemanticEffectSite";
import {
    completeEndpointResolutionLedger,
    createUnprojectedEndpointResolutionLedgerItem,
    type EndpointResolutionLedgerItem,
} from "./EndpointResolutionLedger";
import {
    createAcceptedWithoutEffectAssetGap,
    createEffectAssetWithoutAcceptedOccurrenceGap,
    createSemanticEffectSiteLedger,
    capabilityFromAssetRole,
    endpointSpecFromBindingTemplate,
    summarizeSemanticEffectLedger,
    type SemanticEffectGapLedgerRecord,
    type SemanticEffectLedgerRecord,
    type SemanticEffectLedgerSummary,
} from "./SemanticEffectSiteLedger";

export interface ApiEffectSite {
    readonly effect: ApiEffectInstance;
    readonly semanticEffectSites: readonly SemanticEffectSite[];
    readonly rawOccurrence: RawApiOccurrence;
    readonly resolvedOccurrence: ResolvedApiOccurrence;
    readonly method: ArkMethod;
    readonly stmt: any;
    readonly invokeExpr?: any;
    readonly fieldRef?: ArkInstanceFieldRef;
    readonly calleeSignature: string;
    readonly memberName: string;
    readonly argCount: number;
}

export interface ApiCanonicalOccurrenceSite {
    readonly rawOccurrence: RawApiOccurrence;
    readonly resolvedOccurrence: ResolvedApiOccurrence;
    readonly method: ArkMethod;
    readonly stmt: any;
}

export interface ApiCanonicalDecoratorOccurrenceSite {
    readonly rawOccurrence: RawApiOccurrence;
    readonly resolvedOccurrence: ResolvedApiOccurrence;
    readonly ownerKind: "namespace" | "class" | "method" | "field";
    readonly model: any;
    readonly semanticEffectSites: readonly SemanticEffectSite[];
    readonly decorator: {
        readonly kind: string;
        readonly param?: string;
        readonly content?: string;
    };
}

export interface ApiEffectRuntimeIndexStats {
    rawOccurrenceCount: number;
    acceptedOccurrenceCount: number;
    effectSiteCount: number;
    rejectedOccurrenceCount: number;
    unresolvedOccurrenceCount: number;
    ambiguousOccurrenceCount: number;
}

export interface ApiEffectRuntimeIndexInput {
    scene: Scene;
    assets: AssetDocumentBase[];
    assetIdentityIndex: AssetIdentityIndex;
    canonicalApiRegistry: CanonicalApiRegistry;
}

interface ArkUiChainState {
    componentName: string;
}

interface ArkUiEventDescriptor {
    componentName: string;
    attributeOwner: string;
    eventName: string;
    callbackArgCount: number;
}

interface ImportBaseResolution {
    importInfo: any;
    localName: string;
    memberChainPrefix: string[];
    aliasChain: string[];
    shadowed: boolean;
    constructed?: boolean;
}

interface ReceiverProvenanceState {
    moduleSpecifier: string;
    receiverType: string;
    localName: string;
    sourceFile: string;
    enclosingMethodSignature: string;
    producerOccurrenceId: string;
    producerCanonicalApiId: string;
    producerMemberName: string;
}

type ReceiverProvenanceStore = Map<string, ReceiverProvenanceState[]>;

interface AcceptedOccurrenceEffectBindingInput {
    raw: RawApiOccurrence;
    resolved: ResolvedApiOccurrence;
    method?: ArkMethod;
    stmt?: any;
    invokeExpr?: any;
    fieldRef?: ArkInstanceFieldRef;
    attachRuntimeSite: boolean;
}

interface EffectGapClassification {
    reasonCode: string;
    diagnosticDetails: Record<string, unknown>;
}

interface OccurrenceObservationStats {
    acceptedDirectCount: number;
    unresolvedDirectCount: number;
    ambiguousDirectCount: number;
    rejectedDirectCount: number;
    candidateCount: number;
    unresolvedCandidateCount: number;
    ambiguousCandidateCount: number;
    rejectedCandidateCount: number;
}

export class ApiEffectRuntimeIndex {
    private readonly rawOccurrences: RawApiOccurrence[] = [];
    private readonly resolvedOccurrences: ResolvedApiOccurrence[] = [];
    private officialOccurrenceRecords: OfficialOccurrenceRecord[] = [];
    private readonly canonicalOccurrenceSites: ApiCanonicalOccurrenceSite[] = [];
    private readonly canonicalOccurrenceSitesByStmt = new WeakMap<object, ApiCanonicalOccurrenceSite[]>();
    private readonly canonicalDecoratorOccurrenceSites: ApiCanonicalDecoratorOccurrenceSite[] = [];
    private readonly effectSites: ApiEffectSite[] = [];
    private readonly detachedSemanticEffectSites: SemanticEffectSite[] = [];
    private readonly semanticEffectGaps: SemanticEffectGapLedgerRecord[] = [];
    private readonly sitesByRuleKey = new Map<string, ApiEffectSite[]>();
    private readonly sitesByStmt = new WeakMap<object, ApiEffectSite[]>();
    private readonly effectsByIdentityKey = new Map<string, ApiEffectInstance[]>();
    private readonly arkUiEventsBySiteKey = new Map<string, ArkUiEventDescriptor[]>();
    private readonly arkUiComponents = new Set<string>();
    private readonly officialDecorators = new Set<string>();
    private readonly receiverProvenanceByClassField: ReceiverProvenanceStore = new Map();
    private readonly resolver: ApiOccurrenceResolver;

    private constructor(private readonly input: ApiEffectRuntimeIndexInput) {
        const descriptors = input.canonicalApiRegistry.listDescriptors();
        this.resolver = new ApiOccurrenceResolver(input.canonicalApiRegistry);
        this.buildArkUiDescriptorIndex(descriptors);
        this.collectReceiverClassFieldProvenance(input.scene);
        this.scanScene(input.scene);
        this.officialOccurrenceRecords = buildOfficialOccurrenceRecords({
            rawOccurrences: this.rawOccurrences,
            resolvedOccurrences: this.resolvedOccurrences,
            canonicalApiRegistry: input.canonicalApiRegistry,
        });
    }

    static build(input: ApiEffectRuntimeIndexInput): ApiEffectRuntimeIndex {
        return new ApiEffectRuntimeIndex(input);
    }

    listRawOccurrences(): RawApiOccurrence[] {
        return [...this.rawOccurrences];
    }

    listResolvedOccurrences(): ResolvedApiOccurrence[] {
        return [...this.resolvedOccurrences];
    }

    listOfficialOccurrenceRecords(): OfficialOccurrenceRecord[] {
        return [...this.officialOccurrenceRecords];
    }

    getOfficialOccurrenceCoverage(): OfficialOccurrenceCoverageSnapshot {
        if (this.officialOccurrenceRecords.length === 0) {
            return emptyOfficialOccurrenceCoverageSnapshot();
        }
        return summarizeOfficialOccurrenceCoverage(this.officialOccurrenceRecords);
    }

    listEffectSites(): ApiEffectSite[] {
        return [...this.effectSites];
    }

    listSemanticEffectSites(): SemanticEffectSite[] {
        return this.effectSites.flatMap(site => [...site.semanticEffectSites]);
    }

    listEndpointResolutionLedgerSkeleton(): EndpointResolutionLedgerItem[] {
        return this.listLedgerSemanticEffectSites()
            .map(site => createUnprojectedEndpointResolutionLedgerItem(site));
    }

    completeEndpointResolutionLedger(records: readonly EndpointResolutionLedgerItem[]): EndpointResolutionLedgerItem[] {
        return completeEndpointResolutionLedger(this.listLedgerSemanticEffectSites(), records);
    }

    listSemanticEffectLedger(records: readonly EndpointResolutionLedgerItem[] = []): SemanticEffectLedgerRecord[] {
        return createSemanticEffectSiteLedger({
            semanticSites: this.listLedgerSemanticEffectSites(),
            endpointRecords: this.completeEndpointResolutionLedger(records),
            gaps: this.listSemanticEffectGaps(),
        });
    }

    getSemanticEffectLedgerSummary(records: readonly EndpointResolutionLedgerItem[] = []): SemanticEffectLedgerSummary {
        return summarizeSemanticEffectLedger(this.listSemanticEffectLedger(records));
    }

    listCanonicalOccurrenceSites(): ApiCanonicalOccurrenceSite[] {
        return [...this.canonicalOccurrenceSites];
    }

    listCanonicalDecoratorOccurrenceSites(): ApiCanonicalDecoratorOccurrenceSite[] {
        return [...this.canonicalDecoratorOccurrenceSites];
    }

    getCanonicalOccurrenceSitesForStmt(stmt: any): ApiCanonicalOccurrenceSite[] {
        if (!stmt || typeof stmt !== "object") return [];
        return [...(this.canonicalOccurrenceSitesByStmt.get(stmt) || [])];
    }

    getStats(): ApiEffectRuntimeIndexStats {
        return {
            rawOccurrenceCount: this.rawOccurrences.length,
            acceptedOccurrenceCount: this.resolvedOccurrences.filter(item => item.status === "accepted").length,
            effectSiteCount: this.effectSites.length,
            rejectedOccurrenceCount: this.resolvedOccurrences.filter(item => item.status === "rejected").length,
            unresolvedOccurrenceCount: this.resolvedOccurrences.filter(item => item.status === "unresolved").length,
            ambiguousOccurrenceCount: this.resolvedOccurrences.filter(item => item.status === "ambiguous").length,
        };
    }

    getSitesForRule(rule: ApiIdentityBackedRule | undefined, role?: ApiEffectRole): ApiEffectSite[] {
        if (!hasApiEffectIdentity(rule)) return [];
        if (role && rule.apiEffect.role !== role) return [];
        return [...(this.sitesByRuleKey.get(ruleKey(rule.apiEffect)) || [])];
    }

    hasRuleSiteAtStmt(rule: ApiIdentityBackedRule | undefined, stmt: any, role?: ApiEffectRole): boolean {
        if (!stmt || !hasApiEffectIdentity(rule)) return false;
        if (role && rule.apiEffect.role !== role) return false;
        const expectedKey = ruleKey(rule.apiEffect);
        return (this.sitesByStmt.get(stmt) || []).some(site => ruleKey(site.effect.identity) === expectedKey);
    }

    getEffectInstancesForIdentity(identity: ApiEffectIdentity): ApiEffectInstance[] {
        return [...(this.effectsByIdentityKey.get(ruleKey(identity)) || [])];
    }

    hasModuleSemanticAssetBinding(canonicalApiId: string): boolean {
        return this.input.assetIdentityIndex.findBindings(canonicalApiId, {
            plane: "module",
            roles: ["module", "handoff"],
        }).length > 0;
    }

    private buildArkUiDescriptorIndex(descriptors: CanonicalApiDescriptor[]): void {
        for (const descriptor of descriptors) {
            const event = this.arkUiEventFromDescriptor(descriptor);
            if (event) {
                this.addArkUiEvent(event);
                continue;
            }
            const componentName = descriptor.exportPath.find(item => item.kind === "component")?.name;
            if (componentName) {
                this.arkUiComponents.add(componentName);
            }
            if (descriptor.member.kind === "decorator" && descriptor.member.name) {
                this.officialDecorators.add(descriptor.member.name);
            }
        }
    }

    private arkUiEventFromDescriptor(descriptor: CanonicalApiDescriptor): ArkUiEventDescriptor | undefined {
        const componentName = descriptor.exportPath.find(item => item.kind === "component")?.name
            || componentNameFromAttributeOwner(descriptor.declarationOwner.normalizedName);
        if (!componentName) return undefined;
        if (descriptor.member.kind === "component-event") {
            return {
                componentName,
                attributeOwner: descriptor.declarationOwner.normalizedName,
                eventName: descriptor.member.name,
                callbackArgCount: descriptor.signature.parameters.length,
            };
        }
        if (descriptor.invoke.kind !== "call") return undefined;
        if (descriptor.member.kind !== "method" && descriptor.member.kind !== "function") return undefined;
        if (!this.hasCallbackSourceBinding(descriptor.canonicalApiId)) return undefined;
        return {
            componentName,
            attributeOwner: descriptor.declarationOwner.normalizedName,
            eventName: descriptor.member.name,
            callbackArgCount: descriptor.signature.parameters.length,
        };
    }

    private hasCallbackSourceBinding(canonicalApiId: string): boolean {
        const bindings = this.input.assetIdentityIndex.findBindings(canonicalApiId, { roles: ["source"] });
        return bindings.some(binding => {
            if (endpointIsCallback(binding.endpoint)) return true;
            for (const template of this.resolveTemplates(binding)) {
                if (endpointIsCallback(endpointFromTemplate(template))) return true;
            }
            return false;
        });
    }

    private addArkUiEvent(event: ArkUiEventDescriptor): void {
        this.arkUiComponents.add(event.componentName);
        const key = arkUiEventSiteKey(event.componentName, event.eventName, event.callbackArgCount);
        const list = this.arkUiEventsBySiteKey.get(key) || [];
        if (!list.some(item => arkUiEventDescriptorKey(item) === arkUiEventDescriptorKey(event))) {
            list.push(event);
        }
        this.arkUiEventsBySiteKey.set(key, list);
    }

    private scanScene(scene: Scene): void {
        let sequence = 0;
        for (const method of scene.getMethods()) {
            const cfg = method.getCfg?.();
            if (!cfg) continue;
            const arkUiChainByLocal = new Map<string, ArkUiChainState>();
            const receiverProvenanceByLocal: ReceiverProvenanceStore = new Map();
            const receiverProvenanceByField: ReceiverProvenanceStore = new Map();
            this.seedReceiverProvenanceFieldsForMethod(method, receiverProvenanceByField);
            const promiseResultOccurrenceByLocal = new Map<string, RawApiOccurrence>();
            for (const stmt of cfg.getStmts?.() || []) {
                const invokeExpr = stmt.containsInvokeExpr?.() ? stmt.getInvokeExpr?.() : undefined;
                if (!invokeExpr) {
                    sequence = this.scanNonInvokeStmt(method, stmt, sequence, receiverProvenanceByLocal, receiverProvenanceByField);
                    continue;
                }
                const raw = this.rawOccurrenceFromInvoke(
                    method,
                    stmt,
                    invokeExpr,
                    sequence++,
                    arkUiChainByLocal,
                    receiverProvenanceByLocal,
                    receiverProvenanceByField,
                );
                const resolved = this.acceptRawOccurrence(method, stmt, invokeExpr, undefined, raw);
                this.recordReceiverProvenance(raw, resolved, stmt, receiverProvenanceByLocal, receiverProvenanceByField);
                this.recordPromiseResultUse(raw, resolved, promiseResultOccurrenceByLocal);
                this.markPromiseChainUse(invokeExpr, promiseResultOccurrenceByLocal);
                this.updateArkUiChainState(stmt, invokeExpr, arkUiChainByLocal);
            }
        }
        sequence = this.scanModelDecorators(scene, sequence);
        void sequence;
    }

    private collectReceiverClassFieldProvenance(scene: Scene): void {
        let sequence = 0;
        for (const method of scene.getMethods()) {
            const cfg = method.getCfg?.();
            if (!cfg) continue;
            const arkUiChainByLocal = new Map<string, ArkUiChainState>();
            const receiverProvenanceByLocal: ReceiverProvenanceStore = new Map();
            const receiverProvenanceByField: ReceiverProvenanceStore = new Map();
            for (const stmt of cfg.getStmts?.() || []) {
                const invokeExpr = stmt.containsInvokeExpr?.() ? stmt.getInvokeExpr?.() : undefined;
                if (!invokeExpr) {
                    sequence = this.scanReceiverProvenanceSeedNonInvokeStmt(
                        method,
                        stmt,
                        sequence,
                        receiverProvenanceByLocal,
                        receiverProvenanceByField,
                    );
                    continue;
                }
                const raw = this.rawOccurrenceFromInvoke(
                    method,
                    stmt,
                    invokeExpr,
                    sequence++,
                    arkUiChainByLocal,
                    receiverProvenanceByLocal,
                    receiverProvenanceByField,
                );
                const resolved = this.resolver.resolve(raw);
                this.recordReceiverProvenance(raw, resolved, stmt, receiverProvenanceByLocal, receiverProvenanceByField);
                this.promoteReceiverClassFieldProvenance(method, stmt, receiverProvenanceByField);
                this.updateArkUiChainState(stmt, invokeExpr, arkUiChainByLocal);
            }
        }
        void sequence;
    }

    private scanReceiverProvenanceSeedNonInvokeStmt(
        method: ArkMethod,
        stmt: any,
        sequence: number,
        receiverProvenanceByLocal: ReceiverProvenanceStore,
        receiverProvenanceByField: ReceiverProvenanceStore,
    ): number {
        let next = sequence;
        if (!(stmt instanceof ArkAssignStmt)) return next;
        const left = stmt.getLeftOp?.();
        const right = stmt.getRightOp?.();
        this.propagateReceiverProvenanceAlias(method, left, right, receiverProvenanceByLocal, receiverProvenanceByField);
        if (left instanceof ArkInstanceFieldRef) {
            this.propagateReceiverProvenanceFieldWrite(method, left, right, receiverProvenanceByLocal, receiverProvenanceByField);
            this.promoteReceiverClassFieldProvenance(method, stmt, receiverProvenanceByField);
        }
        if (right instanceof ArkInstanceFieldRef) {
            this.propagateReceiverProvenanceFieldRead(method, left, right, receiverProvenanceByLocal, receiverProvenanceByField);
        }
        if (right instanceof ArkNewExpr) {
            const raw = this.rawOccurrenceFromNewExpr(method, stmt, right, next++);
            const resolved = this.resolver.resolve(raw);
            this.recordReceiverProvenance(raw, resolved, stmt, receiverProvenanceByLocal, receiverProvenanceByField);
            this.promoteReceiverClassFieldProvenance(method, stmt, receiverProvenanceByField);
        }
        return next;
    }

    private seedReceiverProvenanceFieldsForMethod(
        method: ArkMethod,
        receiverProvenanceByField: ReceiverProvenanceStore,
    ): void {
        const classKey = receiverMethodClassKey(method);
        if (!classKey) return;
        for (const [key, provenances] of this.receiverProvenanceByClassField) {
            const parts = receiverClassFieldKeyParts(key);
            if (!parts || parts.classKey !== classKey) continue;
            const fieldKey = `this.${parts.fieldName}`;
            mergeReceiverProvenances(receiverProvenanceByField, fieldKey, provenances.map(item => ({
                ...item,
                localName: fieldKey,
            })));
        }
    }

    private scanNonInvokeStmt(
        method: ArkMethod,
        stmt: any,
        sequence: number,
        receiverProvenanceByLocal: ReceiverProvenanceStore,
        receiverProvenanceByField: ReceiverProvenanceStore,
    ): number {
        let next = sequence;
        if (!(stmt instanceof ArkAssignStmt)) return next;
        const left = stmt.getLeftOp?.();
        const right = stmt.getRightOp?.();
        this.propagateReceiverProvenanceAlias(method, left, right, receiverProvenanceByLocal, receiverProvenanceByField);
        if (left instanceof ArkInstanceFieldRef) {
            this.propagateReceiverProvenanceFieldWrite(method, left, right, receiverProvenanceByLocal, receiverProvenanceByField);
            const raw = this.rawOccurrenceFromField(
                method,
                stmt,
                left,
                next++,
                "write",
                receiverProvenanceByLocal,
                receiverProvenanceByField,
            );
            this.acceptRawOccurrence(method, stmt, undefined, left, raw);
        }
        if (right instanceof ArkInstanceFieldRef) {
            const raw = this.rawOccurrenceFromField(
                method,
                stmt,
                right,
                next++,
                "read",
                receiverProvenanceByLocal,
                receiverProvenanceByField,
            );
            this.acceptRawOccurrence(method, stmt, undefined, right, raw);
            this.propagateReceiverProvenanceFieldRead(method, left, right, receiverProvenanceByLocal, receiverProvenanceByField);
        }
        if (right instanceof ArkNewExpr) {
            const raw = this.rawOccurrenceFromNewExpr(method, stmt, right, next++);
            const resolved = this.acceptRawOccurrence(method, stmt, undefined, undefined, raw);
            this.recordReceiverProvenance(raw, resolved, stmt, receiverProvenanceByLocal, receiverProvenanceByField);
        }
        return next;
    }

    private acceptRawOccurrence(
        method: ArkMethod,
        stmt: any,
        invokeExpr: any | undefined,
        fieldRef: ArkInstanceFieldRef | undefined,
        raw: RawApiOccurrence,
    ): ResolvedApiOccurrence {
        const resolved = this.recordRawOccurrence(raw);
        if (resolved.status !== "accepted" || !resolved.canonicalApiId) return resolved;
        const canonicalSite: ApiCanonicalOccurrenceSite = {
            rawOccurrence: raw,
            resolvedOccurrence: resolved,
            method,
            stmt,
        };
        this.canonicalOccurrenceSites.push(canonicalSite);
        if (stmt && typeof stmt === "object") {
            const stmtSites = this.canonicalOccurrenceSitesByStmt.get(stmt) || [];
            stmtSites.push(canonicalSite);
            this.canonicalOccurrenceSitesByStmt.set(stmt, stmtSites);
        }
        this.recordAcceptedOccurrenceEffectBindings({
            raw,
            resolved,
            method,
            stmt,
            invokeExpr,
            fieldRef,
            attachRuntimeSite: true,
        });
        return resolved;
    }

    private recordAcceptedOccurrenceEffectBindings(input: AcceptedOccurrenceEffectBindingInput): SemanticEffectSite[] {
        const { raw, resolved, method, stmt, invokeExpr, fieldRef } = input;
        const emittedSemanticSites: SemanticEffectSite[] = [];
        if (resolved.status !== "accepted" || !resolved.canonicalApiId) return emittedSemanticSites;
        const bindings = this.input.assetIdentityIndex.findBindings(resolved.canonicalApiId);
        if (bindings.length === 0) {
            const classification = this.classifyAcceptedOccurrenceWithoutBinding(raw, resolved);
            this.recordAcceptedWithoutEffectAsset(
                method,
                stmt,
                raw,
                resolved,
                classification.reasonCode,
                undefined,
                undefined,
                undefined,
                classification.diagnosticDetails,
            );
        }
        for (const binding of bindings) {
            const templateRefs = binding.effectTemplateRefs || [];
            if (templateRefs.length === 0) {
                this.recordAcceptedWithoutEffectAsset(
                    method,
                    stmt,
                    raw,
                    resolved,
                    "template_ref_unresolved",
                    binding,
                    undefined,
                    undefined,
                    {
                        gapClass: "template_ref_unresolved",
                        consumerStatus: "blocked",
                        templateRefStatus: "missing_refs",
                        binding: bindingDiagnostic(binding),
                    },
                );
                continue;
            }
            for (const templateRef of templateRefs) {
                const template = this.input.assetIdentityIndex.getTemplate(templateRef);
                if (!template) {
                    this.recordAcceptedWithoutEffectAsset(
                        method,
                        stmt,
                        raw,
                        resolved,
                        "template_ref_unresolved",
                        binding,
                        undefined,
                        undefined,
                        {
                            gapClass: "template_ref_unresolved",
                            consumerStatus: "blocked",
                            templateRef,
                            binding: bindingDiagnostic(binding),
                            template: unresolvedTemplateDiagnostic(templateRef),
                        },
                    );
                    continue;
                }
                const effect = projectBindingToEffect({
                    occurrence: resolved,
                    binding,
                    template,
                    endpoint: binding.endpoint || endpointFromTemplate(template),
                });
                if (!effect.acceptedForPropagation) {
                    this.recordAcceptedWithoutEffectAsset(
                        method,
                        stmt,
                        raw,
                        resolved,
                        effect.endpointStatus === "unresolved"
                            ? "endpoint_spec_unresolved"
                            : "not_accepted_for_propagation",
                        binding,
                        template,
                        endpointSpecFromBindingTemplate(binding, template),
                        {
                            gapClass: effect.endpointStatus === "unresolved"
                                ? "endpoint_spec_unresolved"
                                : "not_accepted_for_propagation",
                            consumerStatus: "blocked",
                            binding: bindingDiagnostic(binding),
                            template: templateDiagnostic(template),
                            guardStatus: effect.guardStatus,
                            endpointStatus: effect.endpointStatus,
                            diagnostics: effect.diagnostics.map(item => ({ ...item })),
                        },
                    );
                    continue;
                }
                if (input.attachRuntimeSite && method && stmt) {
                    const site = this.buildEffectSite(effect, raw, resolved, method, stmt, invokeExpr, fieldRef);
                    this.addEffectSite(site);
                    emittedSemanticSites.push(...site.semanticEffectSites);
                } else {
                    const detachedSites = semanticEffectSitesFromEffect(effect);
                    this.detachedSemanticEffectSites.push(...detachedSites);
                    emittedSemanticSites.push(...detachedSites);
                }
            }
        }
        return emittedSemanticSites;
    }

    private recordAcceptedWithoutEffectAsset(
        method: ArkMethod | undefined,
        stmt: any,
        raw: RawApiOccurrence,
        resolved: ResolvedApiOccurrence,
        reasonCode: string,
        binding?: AssetBinding,
        template?: SemanticEffectTemplate,
        endpointSpec?: AssetEndpoint,
        diagnosticDetails?: Record<string, unknown>,
    ): void {
        if (!resolved.canonicalApiId) return;
        this.semanticEffectGaps.push(createAcceptedWithoutEffectAssetGap({
            occurrence: {
                occurrenceId: resolved.occurrenceId,
                rawOccurrenceId: raw.rawOccurrenceId,
                canonicalApiId: resolved.canonicalApiId,
                sourceFile: raw.sourceLocation.file,
                sourceLocation: {
                    line: raw.sourceLocation.line,
                    column: raw.sourceLocation.column,
                },
                enclosingMethodSignature: raw.enclosingMethodSignature || method?.getSignature?.()?.toString?.(),
                statementText: raw.statementText || stmt?.toString?.(),
            },
            reasonCode,
            binding,
            template,
            endpointSpec,
            diagnosticDetails,
        }));
    }

    private listSemanticEffectGaps(): SemanticEffectGapLedgerRecord[] {
        return [
            ...this.semanticEffectGaps,
            ...this.buildEffectAssetWithoutAcceptedOccurrenceGaps(),
        ];
    }

    private classifyAcceptedOccurrenceWithoutBinding(
        raw: RawApiOccurrence,
        resolved: ResolvedApiOccurrence,
    ): EffectGapClassification {
        const canonicalApiId = resolved.canonicalApiId!;
        const surfaces = this.input.assetIdentityIndex.findSurfaces(canonicalApiId);
        const descriptor = this.input.canonicalApiRegistry.get(canonicalApiId);
        const nonConsumerKind = noFlowNonConsumerKind(raw, descriptor);
        if (nonConsumerKind) {
            return {
                reasonCode: "no_flow_api",
                diagnosticDetails: {
                    gapClass: "no_flow_api",
                    consumerStatus: "non_consumer",
                    nonConsumerKind,
                    surfaceIds: surfaces.map(surface => surface.surfaceId),
                    descriptor: descriptorDiagnostic(descriptor),
                },
            };
        }
        return {
            reasonCode: "missing_asset_binding",
            diagnosticDetails: {
                gapClass: "missing_asset_binding",
                consumerStatus: "blocked",
                surfaceIds: surfaces.map(surface => surface.surfaceId),
                descriptor: descriptorDiagnostic(descriptor),
            },
        };
    }

    private buildEffectAssetWithoutAcceptedOccurrenceGaps(): SemanticEffectGapLedgerRecord[] {
        const occurrenceStatsByCanonicalApiId = new Map<string, OccurrenceObservationStats>();
        for (const resolved of this.resolvedOccurrences) {
            if (resolved.canonicalApiId) {
                observeOccurrence(occurrenceStatsByCanonicalApiId, resolved.canonicalApiId, resolved.status, false);
            }
            for (const candidate of resolved.candidates || []) {
                if (candidate) observeOccurrence(occurrenceStatsByCanonicalApiId, candidate, resolved.status, true);
            }
        }

        const out: SemanticEffectGapLedgerRecord[] = [];
        const seen = new Set<string>();
        const push = (record: SemanticEffectGapLedgerRecord): void => {
            const key = [
                record.gapKind,
                record.canonicalApiId,
                record.effectAssetId || "",
                record.bindingId || "",
                record.effectTemplateId || "",
                record.reasonCode,
            ].join("|");
            if (seen.has(key)) return;
            seen.add(key);
            out.push(record);
        };

        for (const asset of this.input.assets) {
            if (!isTrustedAnalysisAssetStatus(asset.status)) continue;
            for (const binding of asset.bindings || []) {
                if (!binding.canonicalApiId) continue;
                const occurrenceStats = occurrenceStatsByCanonicalApiId.get(binding.canonicalApiId);
                if (!occurrenceStats || !hasProjectOccurrenceUse(occurrenceStats)) continue;
                if (!capabilityFromAssetRole(binding.role)) continue;
                const acceptedCount = occurrenceStats.acceptedDirectCount;
                if (acceptedCount > 0) continue;
                const classification = classifyEffectAssetWithoutAcceptedOccurrence(occurrenceStats);
                const templateRefs = binding.effectTemplateRefs || [];
                if (templateRefs.length === 0) {
                    push(createEffectAssetWithoutAcceptedOccurrenceGap({
                        canonicalApiId: binding.canonicalApiId,
                        reasonCode: "asset_descriptor_mismatch",
                        binding,
                        acceptedOccurrenceCount: acceptedCount,
                        diagnosticDetails: {
                            ...classification.diagnosticDetails,
                            gapClass: "asset_descriptor_mismatch",
                            descriptorMismatchKind: "missing_effect_template_refs",
                            binding: bindingDiagnostic(binding),
                        },
                    }));
                    continue;
                }
                for (const templateRef of templateRefs) {
                    const template = this.input.assetIdentityIndex.getTemplate(templateRef);
                    const templateClassification = template
                        ? classification
                        : {
                            reasonCode: "asset_descriptor_mismatch",
                            diagnosticDetails: {
                                ...classification.diagnosticDetails,
                                gapClass: "asset_descriptor_mismatch",
                                descriptorMismatchKind: "template_ref_unresolved",
                            },
                        };
                    push(createEffectAssetWithoutAcceptedOccurrenceGap({
                        canonicalApiId: binding.canonicalApiId,
                        reasonCode: templateClassification.reasonCode,
                        binding,
                        template,
                        endpointSpec: endpointSpecFromBindingTemplate(binding, template),
                        acceptedOccurrenceCount: acceptedCount,
                        diagnosticDetails: {
                            ...templateClassification.diagnosticDetails,
                            binding: bindingDiagnostic(binding),
                            template: template ? templateDiagnostic(template) : unresolvedTemplateDiagnostic(templateRef),
                            templateRef,
                        },
                    }));
                }
            }
        }
        return out;
    }

    private propagateReceiverProvenanceAlias(
        method: ArkMethod,
        left: any,
        right: any,
        receiverProvenanceByLocal: ReceiverProvenanceStore,
        receiverProvenanceByField: ReceiverProvenanceStore,
    ): void {
        if (!(left instanceof Local)) return;
        const leftName = left.getName?.() || left.toString?.() || "";
        if (!leftName) return;
        const provenances = receiverProvenanceForValueWithDeclaredType(method, right, receiverProvenanceByLocal, receiverProvenanceByField);
        if (provenances.length === 0) return;
        setReceiverProvenances(receiverProvenanceByLocal, leftName, provenances.map(item => ({
            ...item,
            localName: leftName,
        })));
    }

    private propagateReceiverProvenanceFieldRead(
        method: ArkMethod,
        left: any,
        right: ArkInstanceFieldRef,
        receiverProvenanceByLocal: ReceiverProvenanceStore,
        receiverProvenanceByField: ReceiverProvenanceStore,
    ): void {
        if (!(left instanceof Local)) return;
        const leftName = left.getName?.() || left.toString?.() || "";
        if (!leftName) return;
        const fieldKey = receiverFieldKey(right);
        if (!fieldKey) return;
        const provenances = receiverProvenanceForValueWithDeclaredType(method, right, receiverProvenanceByLocal, receiverProvenanceByField);
        if (provenances.length === 0) return;
        mergeReceiverProvenances(receiverProvenanceByField, fieldKey, provenances.map(item => ({
            ...item,
            localName: fieldKey,
        })));
        setReceiverProvenances(receiverProvenanceByLocal, leftName, provenances.map(item => ({
            ...item,
            localName: leftName,
        })));
    }

    private propagateReceiverProvenanceFieldWrite(
        method: ArkMethod,
        left: ArkInstanceFieldRef,
        right: any,
        receiverProvenanceByLocal: ReceiverProvenanceStore,
        receiverProvenanceByField: ReceiverProvenanceStore,
    ): void {
        const fieldKey = receiverFieldKey(left);
        if (!fieldKey) return;
        const provenances = receiverProvenanceForValueWithDeclaredType(method, right, receiverProvenanceByLocal, receiverProvenanceByField);
        const exactProvenances = provenances.length > 0
            ? provenances
            : declaredReceiverProvenanceForFieldRef(method, left);
        if (exactProvenances.length === 0) return;
        mergeReceiverProvenances(receiverProvenanceByField, fieldKey, exactProvenances.map(item => ({
            ...item,
            localName: fieldKey,
        })));
    }

    private promoteReceiverClassFieldProvenance(
        method: ArkMethod,
        stmt: any,
        receiverProvenanceByField: ReceiverProvenanceStore,
    ): void {
        if (!(stmt instanceof ArkAssignStmt)) return;
        const left = stmt.getLeftOp?.();
        if (!(left instanceof ArkInstanceFieldRef)) return;
        const localFieldKey = receiverFieldKey(left);
        if (!localFieldKey) return;
        const classFieldKey = receiverClassFieldKey(method, left);
        if (!classFieldKey) return;
        const provenances = receiverProvenanceByField.get(localFieldKey) || [];
        if (provenances.length === 0) return;
        mergeReceiverProvenances(this.receiverProvenanceByClassField, classFieldKey, provenances.map(item => ({
            ...item,
            localName: localFieldKey,
        })));
    }

    private recordReceiverProvenance(
        raw: RawApiOccurrence,
        resolved: ResolvedApiOccurrence,
        stmt: any,
        receiverProvenanceByLocal: ReceiverProvenanceStore,
        receiverProvenanceByField: ReceiverProvenanceStore,
    ): void {
        if (resolved.status !== "accepted" || !resolved.canonicalApiId || !raw.ir.resultText) return;
        const descriptor = this.input.canonicalApiRegistry.get(resolved.canonicalApiId);
        if (!descriptor) return;
        const receiverType = descriptor.signature.returnType.text;
        if (!isReceiverReturnType(receiverType)) return;
        const state: ReceiverProvenanceState = {
            moduleSpecifier: descriptor.moduleSpecifier,
            receiverType,
            localName: raw.ir.resultText,
            sourceFile: raw.sourceLocation.file,
            enclosingMethodSignature: raw.enclosingMethodSignature || "",
            producerOccurrenceId: resolved.occurrenceId,
            producerCanonicalApiId: resolved.canonicalApiId,
            producerMemberName: descriptor.member.name,
        };
        const localName = localNameFromResultText(raw.ir.resultText);
        if (localName) {
            setReceiverProvenances(receiverProvenanceByLocal, localName, [{
                ...state,
                localName,
            }]);
            return;
        }
        if (stmt instanceof ArkAssignStmt && stmt.getLeftOp?.() instanceof ArkInstanceFieldRef) {
            const fieldRef = stmt.getLeftOp?.() as ArkInstanceFieldRef;
            const fieldKey = receiverFieldKey(fieldRef);
            if (!fieldKey) return;
            mergeReceiverProvenances(receiverProvenanceByField, fieldKey, [{
                ...state,
                localName: fieldKey,
            }]);
        }
    }

    private recordPromiseResultUse(
        raw: RawApiOccurrence,
        resolved: ResolvedApiOccurrence,
        promiseResultOccurrenceByLocal: Map<string, RawApiOccurrence>,
    ): void {
        if (resolved.status !== "accepted" || !resolved.canonicalApiId || !raw.ir.resultText) return;
        const localName = localNameFromResultText(raw.ir.resultText);
        if (!localName) return;
        const descriptor = this.input.canonicalApiRegistry.get(resolved.canonicalApiId);
        if (!descriptor || !isPromiseReturnType(descriptor.signature.returnType.text)) return;
        promiseResultOccurrenceByLocal.set(localName, raw);
    }

    private markPromiseChainUse(
        invokeExpr: any,
        promiseResultOccurrenceByLocal: Map<string, RawApiOccurrence>,
    ): void {
        if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) return;
        const methodName = invokeMethodName(invokeExpr, invokeExpr.getMethodSignature?.()?.toString?.() || "");
        if (methodName !== "then") return;
        const base = invokeExpr.getBase?.();
        if (!(base instanceof Local)) return;
        const baseName = base.getName?.() || base.toString?.() || "";
        const producer = promiseResultOccurrenceByLocal.get(baseName);
        if (!producer) return;
        producer.ir.resultUseKind = "promise-chain";
    }

    private recordRawOccurrence(raw: RawApiOccurrence): ResolvedApiOccurrence {
        this.rawOccurrences.push(raw);
        const resolved = this.resolver.resolve(raw);
        this.resolvedOccurrences.push(resolved);
        return resolved;
    }

    private listLedgerSemanticEffectSites(): SemanticEffectSite[] {
        return [
            ...this.listSemanticEffectSites(),
            ...this.detachedSemanticEffectSites,
        ];
    }

    private resolveTemplates(binding: AssetBinding): SemanticEffectTemplate[] {
        const refs = binding.effectTemplateRefs || [];
        const out: SemanticEffectTemplate[] = [];
        for (const ref of refs) {
            const template = this.input.assetIdentityIndex.getTemplate(ref);
            if (template) out.push(template);
        }
        return out;
    }

    private buildEffectSite(
        effect: ApiEffectInstance,
        rawOccurrence: RawApiOccurrence,
        resolvedOccurrence: ResolvedApiOccurrence,
        method: ArkMethod,
        stmt: any,
        invokeExpr: any | undefined,
        fieldRef: ArkInstanceFieldRef | undefined,
    ): ApiEffectSite {
        const semanticEffectSites = semanticEffectSitesFromEffect(effect);
        return {
            effect,
            semanticEffectSites,
            rawOccurrence,
            resolvedOccurrence,
            method,
            stmt,
            invokeExpr,
            fieldRef,
            calleeSignature: rawOccurrence.ir.methodSignatureText || "",
            memberName: rawOccurrence.ir.memberName || "",
            argCount: rawOccurrence.ir.argCount || 0,
        };
    }

    private addEffectSite(site: ApiEffectSite): void {
        this.effectSites.push(site);
        const key = ruleKey(site.effect.identity);
        const byKey = this.sitesByRuleKey.get(key) || [];
        byKey.push(site);
        this.sitesByRuleKey.set(key, byKey);
        const effectList = this.effectsByIdentityKey.get(key) || [];
        effectList.push(site.effect);
        this.effectsByIdentityKey.set(key, effectList);
        if (site.stmt && typeof site.stmt === "object") {
            const stmtSites = this.sitesByStmt.get(site.stmt) || [];
            stmtSites.push(site);
            this.sitesByStmt.set(site.stmt, stmtSites);
        }
    }

    private rawOccurrenceFromInvoke(
        method: ArkMethod,
        stmt: any,
        invokeExpr: any,
        sequence: number,
        arkUiChainByLocal: Map<string, ArkUiChainState>,
        receiverProvenanceByLocal: ReceiverProvenanceStore,
        receiverProvenanceByField: ReceiverProvenanceStore,
    ): RawApiOccurrence {
        const calleeSignature = invokeExpr.getMethodSignature?.()?.toString?.() || "";
        const args = invokeExpr.getArgs?.() || [];
        const methodName = invokeMethodName(invokeExpr, calleeSignature);
        const arkUiComponentName = this.arkUiComponentNameForInvoke(methodName, calleeSignature);
        const sourceLocation = sourceLocationFor(method, stmt);
        const unknownSignature = isUnknownSignature(calleeSignature);
        const officialEvidence = arkUiComponentName
            ? [{ kind: "arkui-component" as const, componentName: arkUiComponentName }]
            : undefined;
        const arkuiChainEvidence = this.arkUiEvidenceForInvoke(method, invokeExpr, methodName, args.length, arkUiChainByLocal);
        return {
            rawOccurrenceId: rawOccurrenceId(method, stmt, sequence, "invoke"),
            kind: "invoke",
            sourceLocation,
            enclosingMethodSignature: method.getSignature?.()?.toString?.() || "",
            statementText: stmt.toString?.() || "",
            ir: {
                invokeExprKind: invokeExprKind(invokeExpr),
                methodSignatureText: calleeSignature,
                arkanalyzerMethodKey: arkanalyzerMethodKeyFromInvoke(invokeExpr),
                unknownSignature,
                receiverText: receiverText(invokeExpr),
                memberName: methodName,
                argCount: args.length,
                argTypes: args.map((arg: any) => typeTextOf(arg)),
                resultText: stmt instanceof ArkAssignStmt ? stmt.getLeftOp?.()?.toString?.() : undefined,
                resultUseKind: resultUseKindForStmt(stmt),
            },
            importEvidence: importEvidenceForInvoke(method, stmt, invokeExpr, methodName, args),
            ...receiverEvidenceForInvoke(method, invokeExpr, methodName, args, receiverProvenanceByLocal, receiverProvenanceByField),
            projectEvidence: projectEvidenceForInvoke(invokeExpr),
            ...arkuiChainEvidence,
            arkuiComponentEvidence: this.arkUiComponentEvidenceForInvoke(method, invokeExpr, arkUiComponentName, args),
            officialEvidence,
        };
    }

    private rawOccurrenceFromField(
        method: ArkMethod,
        stmt: any,
        fieldRef: ArkInstanceFieldRef,
        sequence: number,
        accessKind: "read" | "write",
        receiverProvenanceByLocal: ReceiverProvenanceStore,
        receiverProvenanceByField: ReceiverProvenanceStore,
    ): RawApiOccurrence {
        const fieldSignature = fieldRef.getFieldSignature?.()?.toString?.() || "";
        const fieldName = fieldRef.getFieldSignature?.()?.getFieldName?.()
            || extractMemberNameFromText(fieldSignature)
            || "";
        return {
            rawOccurrenceId: rawOccurrenceId(method, stmt, sequence, "field"),
            kind: "property-access",
            sourceLocation: sourceLocationFor(method, stmt),
            enclosingMethodSignature: method.getSignature?.()?.toString?.() || "",
            statementText: stmt.toString?.() || "",
            ir: {
                methodSignatureText: fieldSignature,
                unknownSignature: isUnknownSignature(fieldSignature),
                receiverText: fieldRef.getBase?.()?.toString?.() || "",
                memberName: fieldName,
                argCount: 0,
                argTypes: [],
                resultText: accessKind === "read" && stmt instanceof ArkAssignStmt
                    ? stmt.getLeftOp?.()?.toString?.()
                    : undefined,
                resultUseKind: accessKind === "read" ? resultUseKindForStmt(stmt) : undefined,
                propertyAccessKind: accessKind,
            },
            importEvidence: importEvidenceForField(method, stmt, fieldRef, accessKind),
            ...receiverEvidenceForField(
                method,
                stmt,
                fieldRef,
                fieldName,
                accessKind,
                receiverProvenanceByLocal,
                receiverProvenanceByField,
            ),
            projectEvidence: projectEvidenceForFieldRef(fieldRef),
        };
    }

    private rawOccurrenceFromNewExpr(
        method: ArkMethod,
        stmt: any,
        newExpr: ArkNewExpr,
        sequence: number,
    ): RawApiOccurrence {
        const sourceFile = method.getDeclaringArkClass?.()?.getDeclaringArkFile?.()
            || method.getDeclaringArkFile?.();
        const classText = newExpr.getClassType?.()?.toString?.() || newExpr.toString?.() || "";
        return {
            rawOccurrenceId: rawOccurrenceId(method, stmt, sequence, "construct"),
            kind: "construct",
            sourceLocation: sourceLocationFor(method, stmt),
            enclosingMethodSignature: method.getSignature?.()?.toString?.() || "",
            statementText: stmt.toString?.() || "",
            ir: {
                methodSignatureText: classText,
                unknownSignature: isUnknownSignature(classText),
                receiverText: classText,
                memberName: "constructor",
                argCount: 0,
                argTypes: [],
                resultText: stmt instanceof ArkAssignStmt ? stmt.getLeftOp?.()?.toString?.() : undefined,
                resultUseKind: resultUseKindForStmt(stmt),
            },
            importEvidence: importEvidenceForNewExpr(method, stmt, sourceFile, newExpr),
        };
    }

    private scanModelDecorators(scene: Scene, sequence: number): number {
        let next = sequence;
        for (const namespace of scene.getNamespaces?.() || []) {
            next = this.scanDecoratorsOnModel("namespace", namespace, next);
        }
        for (const klass of scene.getClasses?.() || []) {
            next = this.scanDecoratorsOnModel("class", klass, next);
            for (const field of klass.getFields?.() || []) {
                next = this.scanDecoratorsOnModel("field", field, next);
            }
            for (const method of klass.getMethods?.() || []) {
                next = this.scanDecoratorsOnModel("method", method, next);
            }
        }
        return next;
    }

    private scanDecoratorsOnModel(
        ownerKind: "namespace" | "class" | "method" | "field",
        model: any,
        sequence: number,
    ): number {
        let next = sequence;
        for (const decorator of model.getDecorators?.() || []) {
            const raw = this.rawOccurrenceFromDecorator(ownerKind, model, decorator, next++);
            if (!raw) continue;
            const resolved = this.recordRawOccurrence(raw);
            const semanticEffectSites = this.recordAcceptedOccurrenceEffectBindings({
                raw,
                resolved,
                attachRuntimeSite: false,
            });
            if (resolved.status === "accepted" && resolved.canonicalApiId) {
                this.canonicalDecoratorOccurrenceSites.push({
                    rawOccurrence: raw,
                    resolvedOccurrence: resolved,
                    ownerKind,
                    model,
                    semanticEffectSites,
                    decorator: {
                        kind: String(decorator.getKind?.() || decorator.kind || raw.ir.memberName || "").trim(),
                        param: String(decorator.getParam?.() || decorator.param || "").trim() || undefined,
                        content: String(decorator.getContent?.() || decorator.content || raw.statementText || "").trim() || undefined,
                    },
                });
            }
        }
        return next;
    }

    private rawOccurrenceFromDecorator(
        ownerKind: "namespace" | "class" | "method" | "field",
        model: any,
        decorator: any,
        sequence: number,
    ): RawApiOccurrence | undefined {
        const decoratorName = String(decorator.getKind?.() || decorator.kind || "").trim();
        if (!decoratorName) return undefined;
        const ownerName = decoratorOwnerName(ownerKind, model);
        const sourceLocation = decoratorSourceLocation(ownerKind, model);
        const content = String(decorator.getContent?.() || decorator.content || `@${decoratorName}`).trim();
        const param = String(decorator.getParam?.() || decorator.param || "").trim();
        const officialEvidence = this.officialDecorators.has(decoratorName)
            ? [{
                kind: "decorator" as const,
                decoratorName,
                ownerKind,
                ownerName,
                content,
                param,
            }]
            : undefined;
        return {
            rawOccurrenceId: [
                sourceLocation.file,
                ownerKind,
                ownerName,
                decoratorName,
                sequence,
            ].join("#"),
            kind: "decorator",
            sourceLocation,
            enclosingMethodSignature: ownerKind === "method"
                ? model.getSignature?.()?.toString?.() || ""
                : undefined,
            statementText: content,
            ir: {
                methodSignatureText: `@${decoratorName}`,
                unknownSignature: false,
                memberName: decoratorName,
                argCount: param ? 1 : 0,
                argTypes: [],
            },
            decoratorEvidence: officialEvidence
                ? {
                    decoratorName,
                    ownerKind,
                    ownerName,
                    sourceFile: sourceLocation.file,
                }
                : undefined,
            officialEvidence,
        };
    }

    private arkUiComponentEvidenceForInvoke(
        method: ArkMethod,
        invokeExpr: any,
        componentName: string | undefined,
        args: any[],
    ): RawApiOccurrence["arkuiComponentEvidence"] {
        if (!componentName) return undefined;
        const argShape = argShapeForArgs(method, args);
        return {
            componentName,
            memberName: "call",
            invokeKind: "call",
            argShape: {
                arity: args.length,
                parameterTypes: argShape.parameterTypes,
                returnType: typeTextOf(invokeExpr.getMethodSignature?.()?.getMethodSubSignature?.()?.getReturnType?.()),
                literalKinds: argShape.literalKinds,
                objectKeys: argShape.objectKeys,
                callbackPositions: argShape.callbackPositions,
                spreadPositions: spreadPositionsForInvoke(invokeExpr),
            },
            sourceFile: sourceFileOf(method),
        };
    }

    private arkUiComponentNameForInvoke(methodName: string, calleeSignature: string): string | undefined {
        if (this.arkUiComponents.has(methodName)) return methodName;
        if (methodName !== "create") return undefined;
        const componentName = arkUiComponentNameFromStaticCreateSignature(calleeSignature);
        return componentName && this.arkUiComponents.has(componentName) ? componentName : undefined;
    }

    private arkUiEvidenceForInvoke(
        method: ArkMethod,
        invokeExpr: any,
        methodName: string,
        argCount: number,
        arkUiChainByLocal: Map<string, ArkUiChainState>,
    ): Pick<RawApiOccurrence, "arkuiEvidence" | "arkuiAmbiguityEvidence"> | undefined {
        if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) return undefined;
        const baseName = invokeExpr.getBase?.()?.toString?.() || "";
        const chain = arkUiChainByLocal.get(baseName);
        if (!chain) return undefined;
        const events = this.arkUiEventsBySiteKey.get(arkUiEventSiteKey(chain.componentName, methodName, argCount)) || [];
        if (events.length === 0) return undefined;
        if (events.length > 1) {
            return {
                arkuiAmbiguityEvidence: {
                    componentName: chain.componentName,
                    eventName: methodName,
                    callbackArgCount: argCount,
                    candidates: events.map(event => ({
                        componentName: event.componentName,
                        attributeOwner: event.attributeOwner,
                        eventName: event.eventName,
                        callbackArgCount: event.callbackArgCount,
                        sourceFile: sourceFileOf(method),
                    })),
                },
            };
        }
        const event = events[0];
        return {
            arkuiEvidence: {
                componentName: event.componentName,
                attributeOwner: event.attributeOwner,
                eventName: event.eventName,
                callbackArgCount: event.callbackArgCount,
                sourceFile: sourceFileOf(method),
            },
        };
    }

    private updateArkUiChainState(
        stmt: any,
        invokeExpr: any,
        arkUiChainByLocal: Map<string, ArkUiChainState>,
    ): void {
        if (!(stmt instanceof ArkAssignStmt)) return;
        const left = stmt.getLeftOp?.();
        if (!(left instanceof Local)) return;
        const leftName = left.getName?.() || left.toString?.() || "";
        if (!leftName) return;
        const calleeSignature = invokeExpr.getMethodSignature?.()?.toString?.() || "";
        const methodName = invokeMethodName(invokeExpr, calleeSignature);
        const componentName = this.arkUiComponentNameForInvoke(methodName, calleeSignature);
        if (componentName) {
            arkUiChainByLocal.set(leftName, { componentName });
            return;
        }
        if (invokeExpr instanceof ArkInstanceInvokeExpr) {
            const baseName = invokeExpr.getBase?.()?.toString?.() || "";
            const baseState = arkUiChainByLocal.get(baseName);
            if (baseState) {
                arkUiChainByLocal.set(leftName, baseState);
            }
        }
    }
}

export type ApiEffectRuntimeIndexLike = Pick<
    ApiEffectRuntimeIndex,
    | "getCanonicalOccurrenceSitesForStmt"
    | "listCanonicalOccurrenceSites"
    | "listSemanticEffectSites"
    | "getSitesForRule"
    | "hasRuleSiteAtStmt"
    | "getEffectInstancesForIdentity"
    | "hasModuleSemanticAssetBinding"
    | "getStats"
>;

function decoratorOwnerName(ownerKind: "namespace" | "class" | "method" | "field", model: any): string {
    if (ownerKind === "method") {
        return model.getSignature?.()?.toString?.() || model.getName?.() || "";
    }
    if (ownerKind === "field") {
        return model.getSignature?.()?.toString?.() || model.getName?.() || "";
    }
    return model.getSignature?.()?.toString?.() || model.getName?.() || "";
}

function decoratorSourceLocation(
    ownerKind: "namespace" | "class" | "method" | "field",
    model: any,
): RawApiOccurrence["sourceLocation"] {
    const file = decoratorSourceFile(ownerKind, model);
    if (ownerKind === "field") {
        const pos = model.getOriginPosition?.();
        return {
            file,
            line: pos?.getLineNo?.(),
            column: pos?.getColNo?.(),
        };
    }
    if (ownerKind === "method") {
        return {
            file,
            line: model.getLine?.() ?? undefined,
            column: model.getColumn?.() ?? undefined,
        };
    }
    return {
        file,
        line: model.getLine?.() ?? undefined,
        column: model.getColumn?.() ?? undefined,
    };
}

function decoratorSourceFile(ownerKind: "namespace" | "class" | "method" | "field", model: any): string {
    if (ownerKind === "method") return sourceFileOf(model);
    if (ownerKind === "field") {
        const klass = model.getDeclaringArkClass?.();
        const file = klass?.getDeclaringArkFile?.();
        return String(
            file?.getFilePath?.()
            || file?.getName?.()
            || file?.getFileSignature?.()?.toString?.()
            || "",
        ).replace(/\\/g, "/");
    }
    const file = model.getDeclaringArkFile?.();
    return String(
        file?.getFilePath?.()
        || file?.getName?.()
        || file?.getFileSignature?.()?.toString?.()
        || "",
    ).replace(/\\/g, "/");
}

function endpointFromTemplate(template: SemanticEffectTemplate): AssetEndpoint | undefined {
    const value = (template as any).value || (template as any).to || (template as any).target || (template as any).unit;
    if (value?.endpoint) return value.endpoint as AssetEndpoint;
    if (value?.base) return value as AssetEndpoint;
    return undefined;
}

function importEvidenceForInvoke(
    method: ArkMethod,
    stmt: any,
    invokeExpr: any,
    methodName: string,
    args: any[],
): ImportMemberKey | undefined {
    const sourceFile = method.getDeclaringArkClass?.()?.getDeclaringArkFile?.()
        || method.getDeclaringArkFile?.();
    const base = resolveImportBaseForInvoke(method, stmt, sourceFile, invokeExpr, methodName);
    if (!base) return undefined;
    const importInfo = base.importInfo;
    const moduleSpecifier = normalizeObservedModuleSpecifier(importInfo.getFrom?.() || "");
    if (!moduleSpecifier) return undefined;
    const importKind = importKindOf(importInfo);
    const importedName = importedNameOf(importInfo, importKind, base.localName);
    const returnType = typeTextOf(invokeExpr.getMethodSignature?.()?.getMethodSubSignature?.()?.getReturnType?.());
    const argShape = argShapeForArgs(method, args);
    return {
        moduleSpecifier,
        importKind,
        importedName,
        localBindingId: `${sourceFileOf(method)}:${base.localName}`,
        localName: base.localName,
        aliasChain: [...base.aliasChain],
        memberChain: [...base.memberChainPrefix, methodName].filter(Boolean),
        invokeKind: base.constructed && methodName === "constructor" ? "new" : "call",
        argShape: {
            arity: args.length,
            parameterTypes: argShape.parameterTypes,
            returnType,
            literalKinds: argShape.literalKinds,
            literalValues: argShape.literalValues,
            objectKeys: argShape.objectKeys,
            callbackPositions: argShape.callbackPositions,
            spreadPositions: spreadPositionsForInvoke(invokeExpr),
        },
        scopeEvidence: {
            sourceFile: sourceFileOf(method),
            enclosingMethodSignature: method.getSignature?.()?.toString?.() || "",
            shadowed: base.shadowed,
        },
    };
}

function importEvidenceForNewExpr(
    method: ArkMethod,
    stmt: any,
    sourceFile: any,
    newExpr: ArkNewExpr,
): ImportMemberKey | undefined {
    const base = resolveImportBaseForNewExpr(method, stmt, sourceFile, newExpr);
    if (!base) return undefined;
    const importInfo = base.importInfo;
    const moduleSpecifier = normalizeObservedModuleSpecifier(importInfo.getFrom?.() || "");
    if (!moduleSpecifier) return undefined;
    const importKind = importKindOf(importInfo);
    const importedName = importedNameOf(importInfo, importKind, base.localName);
    return {
        moduleSpecifier,
        importKind,
        importedName,
        localBindingId: `${sourceFileOf(method)}:${base.localName}`,
        localName: base.localName,
        aliasChain: [...base.aliasChain],
        memberChain: [...base.memberChainPrefix, "constructor"].filter(Boolean),
        invokeKind: "new",
        argShape: {
            arity: 0,
            parameterTypes: [],
            returnType: typeTextOf(newExpr.getType?.()),
        },
        scopeEvidence: {
            sourceFile: sourceFileOf(method),
            enclosingMethodSignature: method.getSignature?.()?.toString?.() || "",
            shadowed: base.shadowed,
        },
    };
}

function importEvidenceForField(
    method: ArkMethod,
    stmt: any,
    fieldRef: ArkInstanceFieldRef,
    accessKind: "read" | "write",
): ImportMemberKey | undefined {
    const sourceFile = method.getDeclaringArkClass?.()?.getDeclaringArkFile?.()
        || method.getDeclaringArkFile?.();
    const base = resolveImportBaseForValue(method, stmt, sourceFile, fieldRef.getBase?.(), new Set());
    if (!base) return undefined;
    const importInfo = base.importInfo;
    const moduleSpecifier = normalizeObservedModuleSpecifier(importInfo.getFrom?.() || "");
    if (!moduleSpecifier) return undefined;
    const importKind = importKindOf(importInfo);
    const importedName = importedNameOf(importInfo, importKind, base.localName);
    const fieldName = fieldRef.getFieldSignature?.()?.getFieldName?.()
        || fieldRef.getFieldName?.()
        || "";
    const valueShape = argShapeForFieldAccess(method, stmt, accessKind, fieldRef);
    return {
        moduleSpecifier,
        importKind,
        importedName,
        localBindingId: `${sourceFileOf(method)}:${base.localName}`,
        localName: base.localName,
        aliasChain: [...base.aliasChain],
        memberChain: [...base.memberChainPrefix, fieldName].filter(Boolean),
        invokeKind: accessKind === "write" ? "property-write" : "property-read",
        argShape: {
            arity: valueShape.parameterTypes.length,
            parameterTypes: valueShape.parameterTypes,
            returnType: typeTextOf(fieldRef.getType?.()),
            literalKinds: valueShape.literalKinds,
            literalValues: valueShape.literalValues,
            objectKeys: valueShape.objectKeys,
            callbackPositions: valueShape.callbackPositions,
        },
        scopeEvidence: {
            sourceFile: sourceFileOf(method),
            enclosingMethodSignature: method.getSignature?.()?.toString?.() || "",
            shadowed: base.shadowed,
        },
    };
}

function receiverEvidenceForField(
    method: ArkMethod,
    stmt: any,
    fieldRef: ArkInstanceFieldRef,
    fieldName: string,
    accessKind: "read" | "write",
    receiverProvenanceByLocal: ReceiverProvenanceStore,
    receiverProvenanceByField: ReceiverProvenanceStore,
): Pick<RawApiOccurrence, "receiverEvidence" | "receiverAmbiguityEvidence"> {
    const base = fieldRef.getBase?.();
    const baseName = base?.getName?.() || base?.toString?.() || "";
    if (!baseName) return {};
    const provenances = receiverProvenanceForValueWithDeclaredType(method, base, receiverProvenanceByLocal, receiverProvenanceByField);
    if (provenances.length === 0) return {};
    if (provenances.length > 1) {
        return {
            receiverAmbiguityEvidence: {
                localName: baseName,
                candidates: provenances.map(item => ({
                    moduleSpecifier: item.moduleSpecifier,
                    receiverType: item.receiverType,
                    sourceFile: item.sourceFile,
                    enclosingMethodSignature: item.enclosingMethodSignature,
                    localName: item.localName,
                    producerOccurrenceId: item.producerOccurrenceId,
                    producerCanonicalApiId: item.producerCanonicalApiId,
                    producerMemberName: item.producerMemberName,
                })),
            },
        };
    }
    const provenance = provenances[0];
    const valueShape = argShapeForFieldAccess(method, stmt, accessKind, fieldRef);
    return {
        receiverEvidence: {
            moduleSpecifier: provenance.moduleSpecifier,
            receiverType: provenance.receiverType,
            memberName: fieldName,
            invokeKind: accessKind === "write" ? "property-write" : "property-read",
            argShape: {
                arity: valueShape.parameterTypes.length,
                parameterTypes: valueShape.parameterTypes,
                returnType: accessKind === "write" ? "void" : typeTextOf(fieldRef.getType?.()),
                literalKinds: valueShape.literalKinds,
                literalValues: valueShape.literalValues,
                objectKeys: valueShape.objectKeys,
                callbackPositions: valueShape.callbackPositions,
            },
            provenance: {
                sourceFile: sourceFileOf(method),
                enclosingMethodSignature: method.getSignature?.()?.toString?.() || "",
                localName: baseName,
                producerOccurrenceId: provenance.producerOccurrenceId,
                producerCanonicalApiId: provenance.producerCanonicalApiId,
                producerMemberName: provenance.producerMemberName,
            },
        },
    };
}

function receiverEvidenceForInvoke(
    method: ArkMethod,
    invokeExpr: any,
    methodName: string,
    args: any[],
    receiverProvenanceByLocal: ReceiverProvenanceStore,
    receiverProvenanceByField: ReceiverProvenanceStore,
): Pick<RawApiOccurrence, "receiverEvidence" | "receiverAmbiguityEvidence"> {
    if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) return {};
    const base = invokeExpr.getBase?.();
    const baseName = base.getName?.() || base.toString?.() || "";
    if (!baseName) return {};
    const provenances = receiverProvenanceForValueWithDeclaredType(method, base, receiverProvenanceByLocal, receiverProvenanceByField);
    if (provenances.length === 0) return {};
    if (provenances.length > 1) {
        return {
            receiverAmbiguityEvidence: {
                localName: baseName,
                candidates: provenances.map(item => ({
                    moduleSpecifier: item.moduleSpecifier,
                    receiverType: item.receiverType,
                    sourceFile: item.sourceFile,
                    enclosingMethodSignature: item.enclosingMethodSignature,
                    localName: item.localName,
                    producerOccurrenceId: item.producerOccurrenceId,
                    producerCanonicalApiId: item.producerCanonicalApiId,
                    producerMemberName: item.producerMemberName,
                })),
            },
        };
    }
    const provenance = provenances[0];
    const argShape = argShapeForArgs(method, args);
    return {
        receiverEvidence: {
            moduleSpecifier: provenance.moduleSpecifier,
            receiverType: provenance.receiverType,
            memberName: methodName,
            invokeKind: "call",
            argShape: {
                arity: args.length,
                parameterTypes: argShape.parameterTypes,
                returnType: typeTextOf(invokeExpr.getMethodSignature?.()?.getMethodSubSignature?.()?.getReturnType?.()),
                literalKinds: argShape.literalKinds,
                literalValues: argShape.literalValues,
                objectKeys: argShape.objectKeys,
                callbackPositions: argShape.callbackPositions,
                spreadPositions: spreadPositionsForInvoke(invokeExpr),
            },
            provenance: {
                sourceFile: sourceFileOf(method),
                enclosingMethodSignature: method.getSignature?.()?.toString?.() || "",
                localName: baseName,
                producerOccurrenceId: provenance.producerOccurrenceId,
                producerCanonicalApiId: provenance.producerCanonicalApiId,
                producerMemberName: provenance.producerMemberName,
            },
        },
    };
}

function receiverProvenanceForValue(
    value: any,
    receiverProvenanceByLocal: ReceiverProvenanceStore,
    receiverProvenanceByField: ReceiverProvenanceStore,
): ReceiverProvenanceState[] {
    if (value instanceof Local) {
        const localName = value.getName?.() || value.toString?.() || "";
        return dedupeReceiverProvenances(receiverProvenanceByLocal.get(localName) || []);
    }
    if (value instanceof ArkInstanceFieldRef) {
        const fieldKey = receiverFieldKey(value);
        return fieldKey ? dedupeReceiverProvenances(receiverProvenanceByField.get(fieldKey) || []) : [];
    }
    return [];
}

function receiverProvenanceForValueWithDeclaredType(
    method: ArkMethod,
    value: any,
    receiverProvenanceByLocal: ReceiverProvenanceStore,
    receiverProvenanceByField: ReceiverProvenanceStore,
): ReceiverProvenanceState[] {
    const direct = receiverProvenanceForValue(value, receiverProvenanceByLocal, receiverProvenanceByField);
    if (direct.length > 0) return direct;
    if (value instanceof ArkAwaitExpr) {
        return receiverProvenanceForValueWithDeclaredType(
            method,
            value.getPromise?.(),
            receiverProvenanceByLocal,
            receiverProvenanceByField,
        );
    }
    if (value instanceof Local) {
        return [
            ...declaredReceiverProvenanceForLocalParameter(method, value),
            ...declaredReceiverProvenanceForCapturedParentParameter(method, value),
        ];
    }
    if (value instanceof ArkInstanceFieldRef) {
        return declaredReceiverProvenanceForFieldRef(method, value);
    }
    return [];
}

function setReceiverProvenances(
    store: ReceiverProvenanceStore,
    key: string,
    provenances: readonly ReceiverProvenanceState[],
): void {
    const normalized = dedupeReceiverProvenances(provenances);
    if (normalized.length === 0) return;
    store.set(key, normalized);
}

function mergeReceiverProvenances(
    store: ReceiverProvenanceStore,
    key: string,
    provenances: readonly ReceiverProvenanceState[],
): void {
    setReceiverProvenances(store, key, [...(store.get(key) || []), ...provenances]);
}

function dedupeReceiverProvenances(provenances: readonly ReceiverProvenanceState[]): ReceiverProvenanceState[] {
    const out = new Map<string, ReceiverProvenanceState>();
    for (const provenance of provenances) {
        out.set(receiverProvenanceKey(provenance), provenance);
    }
    return [...out.values()];
}

function receiverProvenanceKey(provenance: ReceiverProvenanceState): string {
    return [
        provenance.moduleSpecifier,
        provenance.receiverType,
        provenance.producerOccurrenceId,
        provenance.producerCanonicalApiId,
    ].join("|");
}

function receiverFieldKey(fieldRef: ArkInstanceFieldRef): string {
    const base = fieldRef.getBase?.()?.toString?.() || "";
    const fieldName = fieldRef.getFieldSignature?.()?.getFieldName?.()
        || fieldRef.getFieldName?.()
        || "";
    if (!base || !fieldName) return "";
    return `${base}.${fieldName}`;
}

function receiverClassFieldKey(method: ArkMethod, fieldRef: ArkInstanceFieldRef): string {
    const base = fieldRef.getBase?.();
    const baseName = base?.getName?.() || base?.toString?.() || "";
    if (baseName !== "this") return "";
    const fieldName = receiverFieldName(fieldRef);
    if (!fieldName) return "";
    const classKey = fieldRef.getFieldSignature?.()?.getDeclaringSignature?.()?.toString?.()
        || receiverMethodClassKey(method);
    if (!classKey) return "";
    return receiverClassFieldKeyFromParts(classKey, fieldName);
}

function receiverMethodClassKey(method: ArkMethod): string {
    return method.getDeclaringArkClass?.()?.getSignature?.()?.toString?.()
        || method.getSignature?.()?.getDeclaringClassSignature?.()?.toString?.()
        || method.getDeclaringArkClass?.()?.getName?.()
        || "";
}

function receiverFieldName(fieldRef: ArkInstanceFieldRef): string {
    return fieldRef.getFieldSignature?.()?.getFieldName?.()
        || fieldRef.getFieldName?.()
        || "";
}

const RECEIVER_CLASS_FIELD_KEY_SEPARATOR = "\t";

function receiverClassFieldKeyFromParts(classKey: string, fieldName: string): string {
    return `${classKey}${RECEIVER_CLASS_FIELD_KEY_SEPARATOR}${fieldName}`;
}

function receiverClassFieldKeyParts(key: string): { classKey: string; fieldName: string } | undefined {
    const splitAt = key.lastIndexOf(RECEIVER_CLASS_FIELD_KEY_SEPARATOR);
    if (splitAt <= 0 || splitAt >= key.length - 1) return undefined;
    return {
        classKey: key.slice(0, splitAt),
        fieldName: key.slice(splitAt + RECEIVER_CLASS_FIELD_KEY_SEPARATOR.length),
    };
}

function declaredReceiverProvenanceForFieldRef(
    method: ArkMethod,
    fieldRef: ArkInstanceFieldRef,
): ReceiverProvenanceState[] {
    const fieldKey = receiverFieldKey(fieldRef);
    if (!fieldKey) return [];
    const declaredType = declaredTypeTextForFieldRef(fieldRef);
    if (!declaredType || isUnknownIdentityText(declaredType)) return [];
    const sourceFile = method.getDeclaringArkClass?.()?.getDeclaringArkFile?.()
        || method.getDeclaringArkFile?.();
    const binding = declaredReceiverBindingFromType(sourceFile, declaredType);
    if (!binding) return [];
    return [{
        moduleSpecifier: binding.moduleSpecifier,
        receiverType: binding.receiverType,
        localName: fieldKey,
        sourceFile: sourceFileOf(method),
        enclosingMethodSignature: method.getSignature?.()?.toString?.() || "",
        producerOccurrenceId: [
            "declared-field-type",
            sourceFileOf(method),
            receiverClassFieldKey(method, fieldRef) || fieldKey,
            binding.moduleSpecifier,
            binding.receiverType,
        ].join(":"),
        producerCanonicalApiId: "",
        producerMemberName: receiverFieldName(fieldRef),
    }];
}

function declaredTypeTextForFieldRef(fieldRef: ArkInstanceFieldRef): string {
    const signatureType = fieldRef.getFieldSignature?.()?.getType?.();
    const signatureText = typeTextOf(signatureType);
    if (signatureText && !isUnknownIdentityText(signatureText)) return signatureText;
    const fieldTypeText = typeTextOf(fieldRef.getType?.());
    return isUnknownIdentityText(fieldTypeText) ? "" : fieldTypeText;
}

function declaredReceiverProvenanceForLocalParameter(
    method: ArkMethod,
    local: Local,
): ReceiverProvenanceState[] {
    const localName = local.getName?.() || local.toString?.() || "";
    if (!localName) return [];
    const declaringStmt = local.getDeclaringStmt?.();
    if (!(declaringStmt instanceof ArkAssignStmt)) return [];
    const parameterRef = declaringStmt.getRightOp?.();
    if (!(parameterRef instanceof ArkParameterRef)) return [];
    const parameterIndex = parameterRef.getIndex?.();
    if (!Number.isInteger(parameterIndex) || parameterIndex < 0) return [];
    const parameters = method.getParameters?.() || [];
    const parameter = parameters[parameterIndex];
    if (!parameter) return [];
    const declaredType = declaredTypeTextForParameter(parameter, parameterRef);
    if (!declaredType || isUnknownIdentityText(declaredType)) return [];
    const sourceFile = method.getDeclaringArkClass?.()?.getDeclaringArkFile?.()
        || method.getDeclaringArkFile?.();
    const binding = declaredReceiverBindingFromType(sourceFile, declaredType);
    if (!binding) return [];
    const parameterName = parameter.getName?.() || "";
    return [{
        moduleSpecifier: binding.moduleSpecifier,
        receiverType: binding.receiverType,
        localName,
        sourceFile: sourceFileOf(method),
        enclosingMethodSignature: method.getSignature?.()?.toString?.() || "",
        producerOccurrenceId: [
            "declared-parameter-type",
            sourceFileOf(method),
            method.getSignature?.()?.toString?.() || "",
            String(parameterIndex),
            localName,
            binding.moduleSpecifier,
            binding.receiverType,
        ].join(":"),
        producerCanonicalApiId: "",
        producerMemberName: parameterName,
    }];
}

function declaredReceiverProvenanceForCapturedParentParameter(
    method: ArkMethod,
    local: Local,
): ReceiverProvenanceState[] {
    const localName = local.getName?.() || local.toString?.() || "";
    if (!localName) return [];
    const parentMethod = exactAnonymousObjectLiteralParentMethod(method);
    if (!parentMethod) return [];
    const parameters = parentMethod.getParameters?.() || [];
    const matches: Array<{ parameter: any; index: number; declaredType: string }> = [];
    for (let index = 0; index < parameters.length; index++) {
        const parameter = parameters[index];
        const parameterName = parameter?.getName?.() || "";
        if (parameterName !== localName) continue;
        const declaredType = declaredTypeTextForParameterByModel(parameter);
        if (!declaredType || isUnknownIdentityText(declaredType)) continue;
        matches.push({ parameter, index, declaredType });
    }
    if (matches.length !== 1) return [];
    const match = matches[0];
    const sourceFile = parentMethod.getDeclaringArkClass?.()?.getDeclaringArkFile?.()
        || parentMethod.getDeclaringArkFile?.();
    const binding = declaredReceiverBindingFromType(sourceFile, match.declaredType);
    if (!binding) return [];
    return [{
        moduleSpecifier: binding.moduleSpecifier,
        receiverType: binding.receiverType,
        localName,
        sourceFile: sourceFileOf(method),
        enclosingMethodSignature: method.getSignature?.()?.toString?.() || "",
        producerOccurrenceId: [
            "declared-captured-parent-parameter-type",
            sourceFileOf(parentMethod),
            parentMethod.getSignature?.()?.toString?.() || "",
            String(match.index),
            localName,
            binding.moduleSpecifier,
            binding.receiverType,
        ].join(":"),
        producerCanonicalApiId: "",
        producerMemberName: match.parameter?.getName?.() || localName,
    }];
}

function exactAnonymousObjectLiteralParentMethod(method: ArkMethod): ArkMethod | undefined {
    const declaringClass = method.getDeclaringArkClass?.();
    const className = declaringClass?.getName?.() || "";
    const parentRef = parseAnonymousObjectLiteralClassParentRef(className);
    if (!parentRef) return undefined;
    const sourceFile = declaringClass?.getDeclaringArkFile?.() || method.getDeclaringArkFile?.();
    const ownerClass = sourceFile?.getClassWithName?.(parentRef.ownerClassName);
    if (!ownerClass) return undefined;
    const methods = ownerClass.getMethodsWithName?.(parentRef.methodName)
        || ownerClass.getAllMethodsWithName?.(parentRef.methodName)
        || [];
    const matches = methods.filter((candidate: ArkMethod) =>
        candidate?.getName?.() === parentRef.methodName
        && candidate?.getDeclaringArkClass?.()?.getName?.() === parentRef.ownerClassName
        && sourceFileOf(candidate) === sourceFileOf(method)
    );
    return matches.length === 1 ? matches[0] : undefined;
}

function parseAnonymousObjectLiteralClassParentRef(
    className: string,
): { ownerClassName: string; methodName: string } | undefined {
    const marker = className.indexOf("$");
    if (!className.startsWith("%AC") || marker < 0 || marker >= className.length - 1) return undefined;
    const suffix = className.slice(marker + 1);
    const splitAt = suffix.lastIndexOf("-");
    if (splitAt <= 0 || splitAt >= suffix.length - 1) return undefined;
    const ownerClassName = suffix.slice(0, splitAt);
    const methodName = suffix.slice(splitAt + 1);
    if (!ownerClassName || !methodName) return undefined;
    return { ownerClassName, methodName };
}

function declaredTypeTextForParameter(parameter: any, parameterRef: ArkParameterRef): string {
    const candidates = uniqueSorted([
        typeTextOf(parameter?.getType?.()),
        typeTextOf(parameterRef.getType?.()),
    ].filter(value => !isUnknownIdentityText(value)));
    return candidates.length === 1 ? candidates[0] : "";
}

function declaredTypeTextForParameterByModel(parameter: any): string {
    const declaredType = typeTextOf(parameter?.getType?.());
    return isUnknownIdentityText(declaredType) ? "" : declaredType;
}

function declaredReceiverBindingFromType(
    sourceFile: any,
    typeText: string,
): { moduleSpecifier: string; receiverType: string } | undefined {
    const roots = receiverDeclaredTypeRoots(typeText);
    if (roots.length === 0) return undefined;
    const resolved = roots
        .map(root => declaredReceiverBindingForRoot(sourceFile, root))
        .filter((item): item is { moduleSpecifier: string; receiverType: string } => item !== undefined);
    if (resolved.length !== roots.length) return undefined;
    const moduleSpecifiers = uniqueSorted(resolved.map(item => item.moduleSpecifier));
    const receiverTypes = uniqueSorted(resolved.map(item => item.receiverType));
    if (moduleSpecifiers.length !== 1 || receiverTypes.length !== 1) return undefined;
    return {
        moduleSpecifier: moduleSpecifiers[0],
        receiverType: receiverTypes[0],
    };
}

function declaredReceiverBindingForRoot(
    sourceFile: any,
    receiverType: string,
): { moduleSpecifier: string; receiverType: string } | undefined {
    const importType = /^import\(["']([^"']+)["']\)\.([A-Za-z_$][A-Za-z0-9_$.]*)$/.exec(receiverType);
    if (importType) {
        const moduleSpecifier = normalizeObservedModuleSpecifier(importType[1]);
        return moduleSpecifier ? { moduleSpecifier, receiverType: importType[2] } : undefined;
    }
    const qualifier = receiverType.includes(".")
        ? receiverType.split(".").filter(Boolean)[0]
        : receiverType;
    if (!qualifier) return undefined;
    const importInfo = sourceFile?.getImportInfoBy?.(qualifier);
    if (!importInfo) return undefined;
    const moduleSpecifier = normalizeObservedModuleSpecifier(importInfo.getFrom?.() || "");
    return moduleSpecifier ? { moduleSpecifier, receiverType } : undefined;
}

function receiverDeclaredTypeRoots(value: string): string[] {
    const unwrapped = unwrapDeclaredReceiverType(value);
    const roots = new Set<string>();
    for (const part of declaredReceiverUnionParts(unwrapped)) {
        const root = normalizeDeclaredReceiverTypeRoot(part);
        if (!root || !isReceiverReturnType(root)) continue;
        roots.add(root);
    }
    return [...roots];
}

function unwrapDeclaredReceiverType(value: string): string {
    let text = normalizeDeclaredReceiverTypeText(value);
    let changed = true;
    while (changed) {
        changed = false;
        const wrapper = /^(?:Promise|Awaited)<(.+)>$/i.exec(text);
        if (wrapper) {
            text = normalizeDeclaredReceiverTypeText(wrapper[1]);
            changed = true;
            continue;
        }
        const nullable = /^\?(.+)$/.exec(text);
        if (nullable) {
            text = normalizeDeclaredReceiverTypeText(nullable[1]);
            changed = true;
        }
    }
    return text;
}

function normalizeDeclaredReceiverTypeRoot(value: string): string {
    return normalizeDeclaredReceiverTypeText(value)
        .replace(/<[^<>]*>/g, "")
        .replace(/^\?/, "")
        .trim();
}

function declaredReceiverUnionParts(value: string): string[] {
    const text = normalizeDeclaredReceiverTypeText(value);
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

function normalizeDeclaredReceiverTypeText(value: string): string {
    return String(value || "")
        .replace(/\s+/g, " ")
        .replace(/\s*([<>,|&()[\]])\s*/g, "$1")
        .trim();
}

function uniqueSorted(values: readonly string[]): string[] {
    return [...new Set(values.filter(value => String(value || "").length > 0))]
        .sort((left, right) => left.localeCompare(right));
}

function resolveImportBaseForInvoke(
    method: ArkMethod,
    stmt: any,
    sourceFile: any,
    invokeExpr: any,
    methodName: string,
): ImportBaseResolution | undefined {
    if (invokeExpr instanceof ArkInstanceInvokeExpr) {
        return resolveImportBaseForValue(method, stmt, sourceFile, invokeExpr.getBase?.(), new Set());
    }
    if (invokeExpr instanceof ArkPtrInvokeExpr) {
        return resolveImportBaseForValue(method, stmt, sourceFile, invokeExpr.getFuncPtrLocal?.(), new Set())
            || resolveImportBaseByName(method, stmt, sourceFile, methodName);
    }
    return resolveImportBaseByName(method, stmt, sourceFile, methodName);
}

function resolveImportBaseForValue(
    method: ArkMethod,
    stmt: any,
    sourceFile: any,
    value: any,
    visited: Set<string>,
): ImportBaseResolution | undefined {
    if (!(value instanceof Local)) return undefined;
    const localName = value.getName?.() || value.toString?.() || "";
    if (!localName || visited.has(localName)) return undefined;
    visited.add(localName);
    const direct = resolveImportBaseByName(method, stmt, sourceFile, localName);
    if (direct) return direct;
    const declaringStmt = value.getDeclaringStmt?.();
    if (!(declaringStmt instanceof ArkAssignStmt)) return undefined;
    const right = declaringStmt.getRightOp?.();
    if (right instanceof Local) {
        const base = resolveImportBaseForValue(method, declaringStmt, sourceFile, right, visited);
        if (!base) return undefined;
        return {
            ...base,
            aliasChain: appendAlias(base.aliasChain, localName),
        };
    }
    if (right instanceof ArkInstanceFieldRef) {
        const base = resolveImportBaseForValue(method, declaringStmt, sourceFile, right.getBase?.(), visited);
        if (!base) return undefined;
        return {
            ...base,
            memberChainPrefix: [...base.memberChainPrefix, right.getFieldName?.() || ""].filter(Boolean),
        };
    }
    if (right instanceof ArkInstanceInvokeExpr) {
        const base = resolveImportBaseForValue(method, declaringStmt, sourceFile, right.getBase?.(), visited);
        if (!base) return undefined;
        const chainedMember = invokeMethodName(right, right.getMethodSignature?.()?.toString?.() || "");
        return {
            ...base,
            memberChainPrefix: [...base.memberChainPrefix, chainedMember].filter(Boolean),
        };
    }
    if (right instanceof ArkNewExpr) {
        return resolveImportBaseForNewExpr(method, declaringStmt, sourceFile, right);
    }
    return undefined;
}

function resolveImportBaseForNewExpr(
    method: ArkMethod,
    stmt: any,
    sourceFile: any,
    newExpr: ArkNewExpr,
): ImportBaseResolution | undefined {
    for (const classChain of classChainsForNewExpr(newExpr)) {
        const importLocalName = classChain[0];
        if (!importLocalName) continue;
        const base = resolveImportBaseByName(method, stmt, sourceFile, importLocalName);
        if (!base) continue;
        return {
            ...base,
            memberChainPrefix: [...base.memberChainPrefix, ...classChain.slice(1)].filter(Boolean),
            constructed: true,
        };
    }
    return undefined;
}

function resolveImportBaseByName(
    method: ArkMethod,
    stmt: any,
    sourceFile: any,
    localName: string,
): ImportBaseResolution | undefined {
    const importInfo = sourceFile?.getImportInfoBy?.(localName);
    if (!importInfo) return undefined;
    return {
        importInfo,
        localName,
        memberChainPrefix: [],
        aliasChain: [],
        shadowed: importNameIsShadowedAtStmt(method, localName, stmt),
    };
}

function appendAlias(aliasChain: readonly string[], localName: string): string[] {
    const normalized = String(localName || "").trim();
    if (!normalized || aliasChain.includes(normalized)) return [...aliasChain];
    return [...aliasChain, normalized];
}

function importNameIsShadowedAtStmt(method: ArkMethod, name: string, stmt: any): boolean {
    if (!name) return false;
    if ((method.getParameters?.() || []).some((parameter: any) => parameter?.getName?.() === name || parameter?.name === name)) {
        return true;
    }
    const local = method.getBody?.()?.getLocals?.()?.get(name);
    const declaringStmt = local?.getDeclaringStmt?.();
    if (!declaringStmt) return false;
    return stmtPositionIsBeforeOrSame(declaringStmt, stmt);
}

function classChainsForNewExpr(newExpr: ArkNewExpr): string[][] {
    const candidates = new Set<string>();
    const classSignature = newExpr.getClassType?.()?.getClassSignature?.();
    addClassChainCandidate(candidates, classSignature?.getClassName?.());
    addClassChainCandidate(candidates, classSignature?.getDeclaringClassName?.());
    addClassChainCandidate(candidates, newExpr.getClassType?.()?.toString?.());
    addClassChainCandidate(candidates, newExpr.toString?.());
    return [...candidates]
        .map(value => value.split(".").map(part => part.trim()).filter(Boolean))
        .filter(chain => chain.length > 0);
}

function addClassChainCandidate(output: Set<string>, value: unknown): void {
    const normalized = normalizeNewExprClassText(value);
    if (normalized) output.add(normalized);
}

function normalizeNewExprClassText(value: unknown): string {
    let text = String(value || "").replace(/\\/g, "/").trim();
    if (!text || isUnknownIdentityText(text)) return "";
    text = text.replace(/^new\s+/, "");
    const paren = text.indexOf("(");
    if (paren >= 0) text = text.slice(0, paren);
    text = text.replace(/<[^<>]*>/g, "");
    const matches = text.match(/[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*/g) || [];
    for (let index = matches.length - 1; index >= 0; index--) {
        const candidate = matches[index];
        if (!candidate || candidate === "new" || candidate === "constructor") continue;
        if (isUnknownIdentityText(candidate)) continue;
        return candidate;
    }
    return "";
}

function stmtPositionIsBeforeOrSame(left: any, right: any): boolean {
    const leftPos = left?.getOriginPositionInfo?.();
    const rightPos = right?.getOriginPositionInfo?.();
    const leftLine = leftPos?.getLineNo?.() ?? -1;
    const leftCol = leftPos?.getColNo?.() ?? -1;
    const rightLine = rightPos?.getLineNo?.() ?? -1;
    const rightCol = rightPos?.getColNo?.() ?? -1;
    if (leftLine < 0 || rightLine < 0) return true;
    return leftLine < rightLine || (leftLine === rightLine && leftCol <= rightCol);
}

function resultUseKindForStmt(stmt: any): RawApiOccurrence["ir"]["resultUseKind"] | undefined {
    if (!(stmt instanceof ArkAssignStmt)) return undefined;
    const right = stmt.getRightOp?.();
    return right instanceof ArkAwaitExpr ? "await-assignment" : "assignment";
}

function localNameFromResultText(value: string): string {
    const text = String(value || "").trim();
    return /^(?:[A-Za-z_$][A-Za-z0-9_$]*|%[A-Za-z0-9_$]+)$/.test(text) ? text : "";
}

function isReceiverReturnType(value: string): boolean {
    const text = String(value || "").trim();
    if (!text) return false;
    const lowered = text.toLowerCase();
    if (lowered === "void" || lowered === "undefined" || lowered === "null" || lowered === "never") return false;
    if (lowered === "string" || lowered === "number" || lowered === "boolean" || lowered === "bigint" || lowered === "symbol") {
        return false;
    }
    if (lowered === "unknown" || lowered === "any" || lowered.includes("%unk") || lowered.includes("@unk")) return false;
    return true;
}

function isPromiseReturnType(value: string): boolean {
    return /^Promise\s*</.test(String(value || "").trim());
}

function spreadPositionsForInvoke(invokeExpr: any): number[] {
    const flags = invokeExpr.getSpreadFlags?.();
    if (!Array.isArray(flags)) return [];
    return flags
        .map((flag, index) => flag ? index : -1)
        .filter(index => index >= 0);
}

function argShapeForFieldAccess(
    method: ArkMethod,
    stmt: any,
    accessKind: "read" | "write",
    fieldRef: ArkInstanceFieldRef,
): Required<Pick<ImportMemberKey["argShape"], "parameterTypes" | "literalKinds" | "literalValues" | "objectKeys" | "callbackPositions">> {
    if (accessKind !== "write" || !(stmt instanceof ArkAssignStmt)) {
        return {
            parameterTypes: [],
            literalKinds: [],
            literalValues: [],
            objectKeys: [],
            callbackPositions: [],
        };
    }
    const left = stmt.getLeftOp?.();
    if (left !== fieldRef) {
        return {
            parameterTypes: [],
            literalKinds: [],
            literalValues: [],
            objectKeys: [],
            callbackPositions: [],
        };
    }
    return argShapeForArgs(method, [stmt.getRightOp?.()]);
}

function argShapeForArgs(method: ArkMethod, args: any[]): Required<Pick<ImportMemberKey["argShape"], "parameterTypes" | "literalKinds" | "literalValues" | "objectKeys" | "callbackPositions">> {
    const literalKinds: Array<{ index: number; kind: string }> = [];
    const literalValues: Array<{ index: number; value: string | number | boolean | null }> = [];
    const objectKeys: Array<{ index: number; keys: string[] }> = [];
    const callbackPositions: number[] = [];
    args.forEach((arg, index) => {
        const kind = literalKindOfArg(method, arg);
        if (kind) literalKinds.push({ index, kind });
        const literalValue = literalValueOfArg(arg);
        if (literalValue !== undefined) literalValues.push({ index, value: literalValue });
        const keys = objectKeysOfArg(method, arg);
        if (keys.length > 0) objectKeys.push({ index, keys });
        if (argIsCallbackLike(arg)) callbackPositions.push(index);
    });
    return {
        parameterTypes: args.map(arg => parameterTypeConstraintText(method, arg)),
        literalKinds,
        literalValues,
        objectKeys,
        callbackPositions,
    };
}

function parameterTypeConstraintText(method: ArkMethod, arg: any): string {
    if (arg instanceof StringConstant) return "unknown";
    if (arg instanceof NumberConstant) return "unknown";
    if (arg instanceof BooleanConstant) return "unknown";
    if (arg instanceof NullConstant) return "unknown";
    if (arg instanceof UndefinedConstant) return "unknown";
    if (arg instanceof ArkNewArrayExpr) return "unknown";
    if (argIsCallbackLike(arg)) return "unknown";
    if (objectKeysOfArg(method, arg).length > 0) return "unknown";
    return typeTextOf(arg);
}

function literalKindOfArg(method: ArkMethod, arg: any): string | undefined {
    if (arg instanceof StringConstant) return "string";
    if (arg instanceof NumberConstant) return "number";
    if (arg instanceof BooleanConstant) return "boolean";
    if (arg instanceof NullConstant) return "null";
    if (arg instanceof UndefinedConstant) return "undefined";
    if (arg instanceof ArkNewArrayExpr) return "array";
    if (argIsCallbackLike(arg)) return "function";
    if (objectKeysOfArg(method, arg).length > 0) return "object";
    const type = arg?.getType?.();
    if (type instanceof ArrayType) return "array";
    return undefined;
}

function literalValueOfArg(arg: any): string | number | boolean | null | undefined {
    if (arg instanceof StringConstant) {
        const value = arg.getValue?.();
        if (typeof value === "string") return value;
        const text = String(arg.toString?.() || "");
        const match = /^['"]([^'"]*)['"]$/.exec(text);
        return match?.[1];
    }
    if (arg instanceof NumberConstant) {
        const value = arg.getValue?.();
        if (typeof value === "number") return value;
        const parsed = Number(String(arg.toString?.() || ""));
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    if (arg instanceof BooleanConstant) {
        const value = arg.getValue?.();
        if (typeof value === "boolean") return value;
        const text = String(arg.toString?.() || "").trim();
        if (text === "true") return true;
        if (text === "false") return false;
    }
    if (arg instanceof NullConstant) return null;
    return undefined;
}

function objectKeysOfArg(method: ArkMethod, arg: any): string[] {
    const type = arg?.getType?.();
    if (!(type instanceof ClassType)) return [];
    const signature = type.getClassSignature?.();
    const scene = method.getDeclaringArkFile?.()?.getScene?.();
    const klass = signature ? scene?.getClass?.(signature) : undefined;
    if (!klass) return [];
    const category = klass.getCategory?.();
    if (category !== ClassCategory.OBJECT && category !== ClassCategory.TYPE_LITERAL) return [];
    return [...new Set((klass.getFields?.() || [])
        .map((field: any) => field.getName?.() || field.getSignature?.()?.getFieldName?.() || "")
        .filter(Boolean))]
        .sort();
}

function argIsCallbackLike(arg: any): boolean {
    const type = arg?.getType?.();
    return type instanceof FunctionType || type?.constructor?.name === "ClosureType";
}

function observeOccurrence(
    target: Map<string, OccurrenceObservationStats>,
    canonicalApiId: string,
    status: ResolvedApiOccurrence["status"],
    asCandidate: boolean,
): void {
    const stats = target.get(canonicalApiId) || emptyOccurrenceObservationStats();
    if (asCandidate) {
        stats.candidateCount++;
        if (status === "unresolved") stats.unresolvedCandidateCount++;
        if (status === "ambiguous") stats.ambiguousCandidateCount++;
        if (status === "rejected") stats.rejectedCandidateCount++;
    } else {
        if (status === "accepted") stats.acceptedDirectCount++;
        if (status === "unresolved") stats.unresolvedDirectCount++;
        if (status === "ambiguous") stats.ambiguousDirectCount++;
        if (status === "rejected") stats.rejectedDirectCount++;
    }
    target.set(canonicalApiId, stats);
}

function emptyOccurrenceObservationStats(): OccurrenceObservationStats {
    return {
        acceptedDirectCount: 0,
        unresolvedDirectCount: 0,
        ambiguousDirectCount: 0,
        rejectedDirectCount: 0,
        candidateCount: 0,
        unresolvedCandidateCount: 0,
        ambiguousCandidateCount: 0,
        rejectedCandidateCount: 0,
    };
}

function hasProjectOccurrenceUse(stats: OccurrenceObservationStats): boolean {
    return stats.acceptedDirectCount > 0
        || stats.unresolvedDirectCount > 0
        || stats.ambiguousDirectCount > 0
        || stats.rejectedDirectCount > 0
        || stats.candidateCount > 0;
}

function classifyEffectAssetWithoutAcceptedOccurrence(
    stats: OccurrenceObservationStats,
): EffectGapClassification {
    const diagnosticDetails = {
        occurrenceObservation: { ...stats },
        projectUseStatus: "observed_without_accepted_occurrence",
    };
    if (stats.ambiguousDirectCount > 0 || stats.ambiguousCandidateCount > 0) {
        return {
            reasonCode: "mirror_or_overload_conflict",
            diagnosticDetails: {
                ...diagnosticDetails,
                gapClass: "mirror_or_overload_conflict",
            },
        };
    }
    if (stats.rejectedDirectCount > 0 || stats.rejectedCandidateCount > 0) {
        return {
            reasonCode: "asset_descriptor_mismatch",
            diagnosticDetails: {
                ...diagnosticDetails,
                gapClass: "asset_descriptor_mismatch",
                descriptorMismatchKind: "candidate_rejected",
            },
        };
    }
    return {
        reasonCode: "identity_not_recovered",
        diagnosticDetails: {
            ...diagnosticDetails,
            gapClass: "identity_not_recovered",
        },
    };
}

function noFlowNonConsumerKind(
    raw: RawApiOccurrence,
    descriptor: CanonicalApiDescriptor | undefined,
): string | undefined {
    if (raw.kind === "entry-slot") return "entry_slot";
    if (raw.kind === "decorator") return "declarative_decorator";
    if (descriptor?.invoke.kind === "entry") return "entry_descriptor";
    if (descriptor?.invoke.kind === "decorator") return "declarative_decorator";
    if (raw.ir.resultText && descriptor && isReceiverReturnType(descriptor.signature.returnType.text)) {
        return "receiver_factory_or_handle";
    }
    if (descriptor && descriptor.signature.parameters.length === 0 && returnsVoidLike(descriptor.signature.returnType.text)) {
        return "zero_arg_control_api";
    }
    return undefined;
}

function returnsVoidLike(value: string): boolean {
    const lowered = String(value || "").trim().toLowerCase();
    return lowered === "void" || lowered === "undefined" || lowered === "never";
}

function bindingDiagnostic(binding: AssetBinding): Record<string, unknown> {
    return {
        assetId: binding.assetId,
        surfaceId: binding.surfaceId,
        bindingId: binding.bindingId,
        canonicalApiId: binding.canonicalApiId,
        role: binding.role,
        plane: binding.plane,
        completeness: binding.completeness,
        confidence: binding.confidence,
        endpointDeclared: !!binding.endpoint,
        effectTemplateRefs: [...(binding.effectTemplateRefs || [])],
    };
}

function templateDiagnostic(template: SemanticEffectTemplate): Record<string, unknown> {
    return {
        id: template.id,
        kind: template.kind,
        confidence: (template as any).confidence,
    };
}

function unresolvedTemplateDiagnostic(templateRef: string): Record<string, unknown> {
    return {
        id: templateRef,
        status: "unresolved",
    };
}

function descriptorDiagnostic(descriptor: CanonicalApiDescriptor | undefined): Record<string, unknown> | undefined {
    if (!descriptor) return undefined;
    return {
        canonicalApiId: descriptor.canonicalApiId,
        authority: descriptor.authority,
        domain: descriptor.domain,
        moduleSpecifier: descriptor.moduleSpecifier,
        ownerKind: descriptor.declarationOwner.kind,
        ownerName: descriptor.declarationOwner.normalizedName,
        memberKind: descriptor.member.kind,
        memberName: descriptor.member.name,
        invokeKind: descriptor.invoke.kind,
        parameterTypes: descriptor.signature.parameters.map(parameter => parameter.type.text),
        returnType: descriptor.signature.returnType.text,
    };
}

function projectEvidenceForInvoke(invokeExpr: any): RawApiOccurrence["projectEvidence"] | undefined {
    const signature = invokeExpr.getMethodSignature?.();
    if (!signature) return undefined;
    const declaringClass = signature.getDeclaringClassSignature?.();
    const subSignature = signature.getMethodSubSignature?.();
    const declaringFile = String(declaringClass?.getDeclaringFileSignature?.()?.toString?.() || "").trim();
    const declaringNamespacePath = namespacePathFromClassSignature(declaringClass);
    const declaringClassName = String(declaringClass?.getClassName?.() || "").trim();
    const methodName = String(subSignature?.getMethodName?.() || extractMemberNameFromText(signature.toString?.() || "") || "").trim();
    const parameterTypes = (subSignature?.getParameters?.() || []).map((param: any) => typeTextOf(param));
    const returnType = typeTextOf(subSignature?.getReturnType?.());
    if (!declaringFile || !methodName || isUnknownIdentityText(declaringFile) || isUnknownIdentityText(methodName)) {
        return undefined;
    }
    if (isUnknownIdentityText(declaringClassName) || isUnknownIdentityText(returnType)) {
        return undefined;
    }
    if (parameterTypes.some(isUnknownIdentityText)) {
        return undefined;
    }
    const fileLevelOwner = !declaringClassName || declaringClassName === "%dflt";
    const namespaceOwner = declaringNamespacePath.join(".");
    const exportPath = declaringNamespacePath.length > 0
        ? [
            `namespace:${namespaceOwner}`,
            ...(fileLevelOwner ? [] : [`namespace:${declaringClassName}`]),
        ]
        : [fileLevelOwner ? "default:file" : `namespace:${declaringClassName}`];
    const ownerPath = declaringNamespacePath.length > 0
        ? [...declaringNamespacePath, ...(fileLevelOwner ? [] : [declaringClassName])]
        : [fileLevelOwner ? "file" : declaringClassName];
    return {
        file: declaringFile,
        exportPath,
        ownerPath,
        memberName: methodName,
        parameterTypes,
        returnType,
    };
}

function projectEvidenceForFieldRef(fieldRef: ArkInstanceFieldRef): RawApiOccurrence["projectEvidence"] | undefined {
    const signature = fieldRef.getFieldSignature?.();
    if (!signature) return undefined;
    const declaringSignature: any = signature.getDeclaringSignature?.();
    if (!declaringSignature) return undefined;
    const fieldName = String(signature.getFieldName?.() || "").trim();
    const returnType = typeTextOf(signature.getType?.());
    if (!fieldName || isUnknownIdentityText(fieldName) || isUnknownIdentityText(returnType)) {
        return undefined;
    }

    const className = String(declaringSignature.getClassName?.() || "").trim();
    if (className) {
        const declaringFile = String(declaringSignature.getDeclaringFileSignature?.()?.toString?.() || "").trim();
        if (!declaringFile || isUnknownIdentityText(declaringFile) || isUnknownIdentityText(className)) {
            return undefined;
        }
        const declaringNamespacePath = namespacePathFromClassSignature(declaringSignature);
        const ownerPath = [...declaringNamespacePath, className].filter(Boolean);
        const exportPath = declaringNamespacePath.length > 0
            ? [`namespace:${declaringNamespacePath.join(".")}`, `namespace:${className}`]
            : [`namespace:${className}`];
        return {
            file: declaringFile,
            exportPath,
            ownerPath,
            memberName: fieldName,
            parameterTypes: [],
            returnType,
        };
    }

    const namespaceName = String(declaringSignature.getNamespaceName?.() || "").trim();
    const declaringFile = String(declaringSignature.getDeclaringFileSignature?.()?.toString?.() || "").trim();
    if (!declaringFile || !namespaceName || isUnknownIdentityText(declaringFile) || isUnknownIdentityText(namespaceName)) {
        return undefined;
    }
    const ownerPath = namespacePathFromNamespaceSignature(declaringSignature);
    const namespacePath = ownerPath.length > 0 ? ownerPath : [namespaceName];
    return {
        file: declaringFile,
        exportPath: [`namespace:${namespacePath.join(".")}`],
        ownerPath: namespacePath,
        memberName: fieldName,
        parameterTypes: [],
        returnType,
    };
}

function importKindOf(importInfo: any): ImportMemberKey["importKind"] {
    const importType = String(importInfo.getImportType?.() || "").toLowerCase();
    if (importInfo.isDefault?.()) return "default";
    if (importType.includes("namespace")) return "namespace";
    return "named";
}

function importedNameOf(importInfo: any, importKind: ImportMemberKey["importKind"], baseName: string): string {
    if (importKind === "default") return "default";
    if (importKind === "namespace") return "*";
    return String(importInfo.getOriginName?.() || importInfo.getImportClauseName?.() || baseName || "").trim();
}

function normalizeObservedModuleSpecifier(value: string): string {
    const raw = String(value || "").replace(/\\/g, "/").trim();
    if (!raw) return "";
    if (raw.startsWith("api/@") && raw.endsWith(".d.ts")) return raw.slice("api/".length, -".d.ts".length);
    if (raw.startsWith("api/@") && raw.endsWith(".d.ets")) return raw.slice("api/".length, -".d.ets".length);
    if (raw.startsWith("ohos/")) return `@ohos.${raw.slice("ohos/".length)}`;
    return raw;
}

function arkanalyzerMethodKeyFromInvoke(invokeExpr: any): RawApiOccurrence["ir"]["arkanalyzerMethodKey"] | undefined {
    const signature = invokeExpr.getMethodSignature?.();
    if (!signature) return undefined;
    const declaringClass = signature.getDeclaringClassSignature?.();
    const subSignature = signature.getMethodSubSignature?.();
    const methodName = subSignature?.getMethodName?.() || extractMemberNameFromText(signature.toString?.() || "");
    const parameters = subSignature?.getParameters?.() || [];
    return {
        declaringFileName: declaringClass?.getDeclaringFileSignature?.()?.toString?.() || "",
        declaringNamespacePath: namespacePathFromClassSignature(declaringClass),
        declaringClassName: declaringClass?.getClassName?.() || "",
        methodName,
        parameterTypes: parameters.map((param: any) => typeTextOf(param)),
        returnType: typeTextOf(subSignature?.getReturnType?.()),
        staticFlag: invokeExpr instanceof ArkStaticInvokeExpr,
    };
}

function namespacePathFromClassSignature(declaringClass: any): string[] {
    const namespaceSignature = declaringClass?.getDeclaringNamespaceSignature?.();
    return namespacePathFromNamespaceSignature(namespaceSignature);
}

function namespacePathFromNamespaceSignature(namespaceSignature: any): string[] {
    return namespacePathFromSignatureText(namespaceSignature?.toString?.() || "");
}

function namespacePathFromSignatureText(value: string): string[] {
    const text = String(value || "")
        .replace(/\\/g, "/")
        .replace(/:\s*$/g, "")
        .trim();
    if (!text) return [];
    const colon = text.lastIndexOf(":");
    const namespaceText = (colon >= 0 ? text.slice(colon + 1) : text).trim();
    if (!namespaceText || namespaceText === "%dflt") return [];
    return namespaceText
        .split(".")
        .map(part => part.trim())
        .filter(part => part.length > 0 && part !== "%dflt");
}

function arkUiComponentNameFromStaticCreateSignature(calleeSignature: string): string | undefined {
    const match = /(?:^|\s)([A-Za-z_$][A-Za-z0-9_$]*)\.create\s*\(/.exec(String(calleeSignature || ""));
    return match?.[1];
}

function invokeMethodName(invokeExpr: any, calleeSignature: string): string {
    const fromSig = invokeExpr.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.();
    if (fromSig) return String(fromSig);
    return extractMemberNameFromText(calleeSignature) || "";
}

function extractMemberNameFromText(value: string): string | undefined {
    const text = String(value || "");
    const callMatch = /\.([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/.exec(text);
    if (callMatch?.[1]) return callMatch[1];
    const fieldMatch = /\.([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:>|$)/.exec(text);
    return fieldMatch?.[1];
}

function receiverText(invokeExpr: any): string | undefined {
    if (invokeExpr instanceof ArkInstanceInvokeExpr) {
        return invokeExpr.getBase?.()?.toString?.() || undefined;
    }
    return undefined;
}

function invokeExprKind(invokeExpr: any): RawApiOccurrence["ir"]["invokeExprKind"] {
    if (invokeExpr instanceof ArkInstanceInvokeExpr) return "ArkInstanceInvokeExpr";
    if (invokeExpr instanceof ArkPtrInvokeExpr) return "ArkPtrInvokeExpr";
    return "ArkStaticInvokeExpr";
}

function sourceLocationFor(method: ArkMethod, stmt: any): RawApiOccurrence["sourceLocation"] {
    const pos = stmt.getOriginPositionInfo?.();
    return {
        file: sourceFileOf(method),
        line: pos?.getLineNo?.(),
        column: pos?.getColNo?.(),
    };
}

function sourceFileOf(method: ArkMethod): string {
    const file = method.getDeclaringArkClass?.()?.getDeclaringArkFile?.()
        || method.getDeclaringArkFile?.();
    return String(
        file?.getFilePath?.()
        || file?.getName?.()
        || file?.getFileSignature?.()?.toString?.()
        || "",
    ).replace(/\\/g, "/");
}

function rawOccurrenceId(method: ArkMethod, stmt: any, sequence: number, kind: string): string {
    const pos = stmt.getOriginPositionInfo?.();
    return [
        sourceFileOf(method),
        method.getSignature?.()?.toString?.() || "",
        pos?.getLineNo?.() ?? -1,
        pos?.getColNo?.() ?? -1,
        kind,
        sequence,
    ].join("#");
}

function isUnknownSignature(value: string): boolean {
    const text = String(value || "");
    return !text || text.includes("%unk") || text.includes("@unk");
}

function isUnknownIdentityText(value: unknown): boolean {
    const text = String(value || "").trim();
    return !text || text.includes("%unk") || text.includes("@unk") || text === "unknown";
}

function typeTextOf(value: any): string {
    return String(value?.getType?.()?.toString?.() || value?.toString?.() || "unknown").trim() || "unknown";
}

function ruleKey(identity: ApiEffectIdentity): string {
    return [
        identity.role,
        identity.canonicalApiId,
        identity.assetId,
        identity.surfaceId,
        identity.bindingId,
        identity.effectTemplateId,
    ].join("|");
}

function arkUiEventSiteKey(componentName: string, eventName: string, callbackArgCount: number): string {
    return `${componentName}|${eventName}|${callbackArgCount}`;
}

function arkUiEventDescriptorKey(event: ArkUiEventDescriptor): string {
    return [
        event.componentName,
        event.attributeOwner,
        event.eventName,
        event.callbackArgCount,
    ].join("|");
}

function componentNameFromAttributeOwner(owner: string): string | undefined {
    const text = String(owner || "");
    if (text.endsWith("Attribute") && text.length > "Attribute".length) {
        return text.slice(0, -"Attribute".length);
    }
    return undefined;
}

function endpointIsCallback(endpoint: AssetEndpoint | undefined): boolean {
    return endpoint?.base?.kind === "callbackArg" || endpoint?.base?.kind === "callbackReturn";
}

