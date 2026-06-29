import type {
    AssetBinding,
    AssetEndpoint,
    AssetRole,
    SemanticEffectTemplate,
} from "../../assets/schema";
import type { ApiEffectRole } from "../ApiOccurrenceIdentity";
import type { OfficialOccurrenceRecord } from "../occurrence";
import type { EndpointResolutionLedgerItem } from "./EndpointResolutionLedger";
import {
    cloneEndpointResolutionLedgerItem,
    completeEndpointResolutionLedger,
} from "./EndpointResolutionLedger";
import type { SemanticEffectSite } from "./SemanticEffectSite";

export type SemanticEffectLedgerRecordKind = "semantic_effect_site" | "semantic_effect_gap";

export type SemanticEffectLedgerStatus =
    | "resolved"
    | "endpoint_gap"
    | "endpoint_projection_not_requested"
    | "effect_gap";

export type SemanticEffectGapKind =
    | "accepted_without_effect_asset"
    | "effect_asset_without_accepted_occurrence";

export interface SemanticEffectAnchor {
    sourceFile?: string;
    sourceLocation?: {
        line?: number;
        column?: number;
    };
    enclosingMethodSignature?: string;
    statementText?: string;
}

export interface SemanticEffectGapLedgerRecord {
    recordKind: "semantic_effect_gap";
    status: "effect_gap";
    gapKind: SemanticEffectGapKind;
    reasonCode: string;
    occurrenceId?: string;
    rawOccurrenceId?: string;
    canonicalApiId: string;
    capability?: ApiEffectRole;
    effectAssetId?: string;
    surfaceId?: string;
    bindingId?: string;
    effectTemplateId?: string;
    endpointSpec?: AssetEndpoint;
    anchor?: SemanticEffectAnchor;
    diagnosticDetails?: Record<string, unknown>;
}

export interface SemanticEffectSiteLedgerRecord {
    recordKind: "semantic_effect_site";
    status: Exclude<SemanticEffectLedgerStatus, "effect_gap">;
    reasonCode: string;
    effectSiteId: string;
    occurrenceId: string;
    rawOccurrenceId?: string;
    canonicalApiId: string;
    capability: ApiEffectRole;
    effectAssetId: string;
    surfaceId?: string;
    bindingId?: string;
    effectTemplateId?: string;
    endpointBindingRef?: string;
    endpointSpec: AssetEndpoint;
    endpointResolution: EndpointResolutionLedgerItem;
}

export type SemanticEffectLedgerRecord =
    | SemanticEffectSiteLedgerRecord
    | SemanticEffectGapLedgerRecord;

export interface SemanticEffectLedgerSummary {
    recordCount: number;
    siteRecordCount: number;
    gapRecordCount: number;
    byRecordKind: Record<string, number>;
    byStatus: Record<string, number>;
    byReasonCode: Record<string, number>;
    byCapability: Record<string, number>;
    byGapKind: Record<string, number>;
    endpointStatusCounts: Record<string, number>;
}

export function createSemanticEffectSiteLedger(input: {
    semanticSites: Iterable<SemanticEffectSite>;
    endpointRecords: Iterable<EndpointResolutionLedgerItem>;
    gaps?: Iterable<SemanticEffectGapLedgerRecord>;
}): SemanticEffectLedgerRecord[] {
    const sites = [...input.semanticSites];
    const siteById = new Map(sites.map(site => [site.effectSiteId, site]));
    const completedEndpointRecords = completeEndpointResolutionLedger(sites, input.endpointRecords);
    const rows: SemanticEffectLedgerRecord[] = [];
    for (const endpointRecord of completedEndpointRecords) {
        const site = siteById.get(endpointRecord.effectSiteId);
        if (!site) continue;
        rows.push(createSemanticEffectSiteRow(site, endpointRecord));
    }
    for (const gap of input.gaps || []) {
        rows.push(cloneSemanticEffectGapRecord(gap));
    }
    return rows.sort(compareSemanticEffectLedgerRecord);
}

export function summarizeSemanticEffectLedger(
    records: readonly SemanticEffectLedgerRecord[],
): SemanticEffectLedgerSummary {
    const summary: SemanticEffectLedgerSummary = {
        recordCount: records.length,
        siteRecordCount: 0,
        gapRecordCount: 0,
        byRecordKind: {},
        byStatus: {},
        byReasonCode: {},
        byCapability: {},
        byGapKind: {},
        endpointStatusCounts: {},
    };
    for (const record of records) {
        increment(summary.byRecordKind, record.recordKind);
        increment(summary.byStatus, record.status);
        increment(summary.byReasonCode, record.reasonCode || "unknown_reason");
        if (record.recordKind === "semantic_effect_site") {
            summary.siteRecordCount++;
            increment(summary.byCapability, record.capability);
            increment(summary.endpointStatusCounts, record.endpointResolution.status);
        } else {
            summary.gapRecordCount++;
            if (record.capability) increment(summary.byCapability, record.capability);
            increment(summary.byGapKind, record.gapKind);
        }
    }
    return summary;
}

export function createAcceptedWithoutEffectAssetGap(input: {
    occurrence: Pick<OfficialOccurrenceRecord,
        "occurrenceId"
        | "rawOccurrenceId"
        | "canonicalApiId"
        | "sourceFile"
        | "sourceLocation"
        | "enclosingMethodSignature"
        | "statementText">;
    reasonCode: string;
    capability?: ApiEffectRole;
    binding?: AssetBinding;
    template?: SemanticEffectTemplate;
    endpointSpec?: AssetEndpoint;
    diagnosticDetails?: Record<string, unknown>;
}): SemanticEffectGapLedgerRecord {
    if (!input.occurrence.canonicalApiId) {
        throw new Error("accepted semantic effect gap requires canonicalApiId");
    }
    return stripEmptyGapFields({
        recordKind: "semantic_effect_gap",
        status: "effect_gap",
        gapKind: "accepted_without_effect_asset",
        reasonCode: input.reasonCode,
        occurrenceId: input.occurrence.occurrenceId,
        rawOccurrenceId: input.occurrence.rawOccurrenceId,
        canonicalApiId: input.occurrence.canonicalApiId,
        capability: input.capability || capabilityFromAssetRole(input.binding?.role),
        effectAssetId: input.binding?.assetId,
        surfaceId: input.binding?.surfaceId,
        bindingId: input.binding?.bindingId,
        effectTemplateId: input.template?.id,
        endpointSpec: input.endpointSpec,
        anchor: anchorFromOccurrence(input.occurrence),
        diagnosticDetails: input.diagnosticDetails,
    });
}

export function createEffectAssetWithoutAcceptedOccurrenceGap(input: {
    canonicalApiId: string;
    reasonCode: string;
    binding: AssetBinding;
    template?: SemanticEffectTemplate;
    endpointSpec?: AssetEndpoint;
    acceptedOccurrenceCount?: number;
    diagnosticDetails?: Record<string, unknown>;
}): SemanticEffectGapLedgerRecord {
    return stripEmptyGapFields({
        recordKind: "semantic_effect_gap",
        status: "effect_gap",
        gapKind: "effect_asset_without_accepted_occurrence",
        reasonCode: input.reasonCode,
        canonicalApiId: input.canonicalApiId,
        capability: capabilityFromAssetRole(input.binding.role),
        effectAssetId: input.binding.assetId,
        surfaceId: input.binding.surfaceId,
        bindingId: input.binding.bindingId,
        effectTemplateId: input.template?.id,
        endpointSpec: input.endpointSpec,
        diagnosticDetails: {
            acceptedOccurrenceCount: input.acceptedOccurrenceCount || 0,
            ...(input.diagnosticDetails || {}),
        },
    });
}

export function capabilityFromAssetRole(role: AssetRole | undefined): ApiEffectRole | undefined {
    switch (role) {
        case "source":
        case "sink":
        case "sanitizer":
        case "transfer":
            return role;
        case "entry":
        case "arkmain":
        case "callback-registration":
            return "arkmain";
        case "handoff":
        case "module":
            return "module";
        default:
            return undefined;
    }
}

export function endpointSpecFromBindingTemplate(
    binding: AssetBinding,
    template?: SemanticEffectTemplate,
): AssetEndpoint | undefined {
    return binding.endpoint || endpointFromTemplate(template);
}

function createSemanticEffectSiteRow(
    site: SemanticEffectSite,
    endpointRecord: EndpointResolutionLedgerItem,
): SemanticEffectSiteLedgerRecord {
    const endpointResolution = cloneEndpointResolutionLedgerItem(endpointRecord);
    const status = statusFromEndpointResolution(endpointResolution.status);
    return stripEmptySiteFields({
        recordKind: "semantic_effect_site",
        status,
        reasonCode: endpointResolution.status === "resolved"
            ? "endpoint_resolved"
            : endpointResolution.status,
        effectSiteId: site.effectSiteId,
        occurrenceId: site.occurrenceId,
        rawOccurrenceId: site.rawOccurrenceId,
        canonicalApiId: site.canonicalApiId,
        capability: site.capability,
        effectAssetId: site.effectAssetId,
        surfaceId: site.surfaceId,
        bindingId: site.bindingId,
        effectTemplateId: site.effectTemplateId,
        endpointBindingRef: site.endpointBindingRef,
        endpointSpec: site.endpointSpec,
        endpointResolution,
    });
}

function statusFromEndpointResolution(status: EndpointResolutionLedgerItem["status"]): SemanticEffectSiteLedgerRecord["status"] {
    if (status === "resolved") return "resolved";
    if (status === "endpoint_projection_not_requested") return "endpoint_projection_not_requested";
    return "endpoint_gap";
}

function endpointFromTemplate(template: SemanticEffectTemplate | undefined): AssetEndpoint | undefined {
    if (!template) return undefined;
    switch (template.kind) {
        case "rule.source":
            return endpointFromRuleValue(template.value);
        case "rule.sink":
        case "rule.sanitizer":
            return template.value ? endpointFromRuleValue(template.value) : undefined;
        case "rule.transfer":
            return endpointFromRuleValue(template.to);
        case "handoff.put":
            return template.value;
        case "handoff.get":
            return template.target;
        case "entry.scheduleUnit":
            return template.unit;
        case "entry.frameworkInvoke":
            return template.target;
        default:
            return undefined;
    }
}

function endpointFromRuleValue(value: unknown): AssetEndpoint | undefined {
    if (!value || typeof value !== "object") return undefined;
    const record = value as Record<string, unknown>;
    if (record.endpoint && typeof record.endpoint === "object") return record.endpoint as AssetEndpoint;
    if (record.base && typeof record.base === "object") return value as AssetEndpoint;
    return undefined;
}

function anchorFromOccurrence(
    occurrence: Pick<OfficialOccurrenceRecord,
        "sourceFile" | "sourceLocation" | "enclosingMethodSignature" | "statementText">,
): SemanticEffectAnchor | undefined {
    const anchor: SemanticEffectAnchor = {
        sourceFile: occurrence.sourceFile,
        sourceLocation: occurrence.sourceLocation,
        enclosingMethodSignature: occurrence.enclosingMethodSignature,
        statementText: occurrence.statementText,
    };
    if (!anchor.sourceFile) delete anchor.sourceFile;
    if (!anchor.sourceLocation || Object.keys(anchor.sourceLocation).length === 0) delete anchor.sourceLocation;
    if (!anchor.enclosingMethodSignature) delete anchor.enclosingMethodSignature;
    if (!anchor.statementText) delete anchor.statementText;
    return Object.keys(anchor).length > 0 ? anchor : undefined;
}

function cloneSemanticEffectGapRecord(record: SemanticEffectGapLedgerRecord): SemanticEffectGapLedgerRecord {
    return stripEmptyGapFields({
        recordKind: "semantic_effect_gap",
        status: "effect_gap",
        gapKind: record.gapKind,
        reasonCode: record.reasonCode,
        occurrenceId: record.occurrenceId,
        rawOccurrenceId: record.rawOccurrenceId,
        canonicalApiId: record.canonicalApiId,
        capability: record.capability,
        effectAssetId: record.effectAssetId,
        surfaceId: record.surfaceId,
        bindingId: record.bindingId,
        effectTemplateId: record.effectTemplateId,
        endpointSpec: cloneJson(record.endpointSpec),
        anchor: cloneJson(record.anchor),
        diagnosticDetails: cloneJson(record.diagnosticDetails),
    });
}

function stripEmptySiteFields(record: SemanticEffectSiteLedgerRecord): SemanticEffectSiteLedgerRecord {
    if (!record.rawOccurrenceId) delete (record as any).rawOccurrenceId;
    if (!record.surfaceId) delete (record as any).surfaceId;
    if (!record.bindingId) delete (record as any).bindingId;
    if (!record.effectTemplateId) delete (record as any).effectTemplateId;
    if (!record.endpointBindingRef) delete (record as any).endpointBindingRef;
    return record;
}

function stripEmptyGapFields(record: SemanticEffectGapLedgerRecord): SemanticEffectGapLedgerRecord {
    if (!record.occurrenceId) delete (record as any).occurrenceId;
    if (!record.rawOccurrenceId) delete (record as any).rawOccurrenceId;
    if (!record.capability) delete (record as any).capability;
    if (!record.effectAssetId) delete (record as any).effectAssetId;
    if (!record.surfaceId) delete (record as any).surfaceId;
    if (!record.bindingId) delete (record as any).bindingId;
    if (!record.effectTemplateId) delete (record as any).effectTemplateId;
    if (!record.endpointSpec) delete (record as any).endpointSpec;
    if (!record.anchor || Object.keys(record.anchor).length === 0) delete (record as any).anchor;
    if (!record.diagnosticDetails || Object.keys(record.diagnosticDetails).length === 0) {
        delete (record as any).diagnosticDetails;
    }
    return record;
}

function compareSemanticEffectLedgerRecord(
    left: SemanticEffectLedgerRecord,
    right: SemanticEffectLedgerRecord,
): number {
    return (left.canonicalApiId || "").localeCompare(right.canonicalApiId || "")
        || (left.recordKind || "").localeCompare(right.recordKind || "")
        || (left.reasonCode || "").localeCompare(right.reasonCode || "")
        || ((left as any).occurrenceId || "").localeCompare((right as any).occurrenceId || "")
        || ((left as any).effectSiteId || "").localeCompare((right as any).effectSiteId || "")
        || ((left as any).bindingId || "").localeCompare((right as any).bindingId || "")
        || ((left as any).effectTemplateId || "").localeCompare((right as any).effectTemplateId || "");
}

function cloneJson<T>(value: T | undefined): T | undefined {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value)) as T;
}

function increment(target: Record<string, number>, key: string): void {
    target[key] = (target[key] || 0) + 1;
}
