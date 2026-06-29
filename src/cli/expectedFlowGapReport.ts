import * as fs from "fs";
import * as path from "path";
import { TraceGraph } from "../core/trace/TraceGraph";
import { FlowQuery, queryTraceGraphMany, TraceWaypoint } from "../core/trace/TraceGraphQuery";
import { explainTraceResults } from "../core/trace/TraceExplain";
import { buildEndpointResolutionSummary, C2_C3_PENDING_CONSUMER_FIELDS, ExpectedFlowGapLayer } from "./c6Diagnostics";
import { resolveAnalyzeOutputLayout } from "./analyzeOutputLayout";

export interface ExpectedFlowLedgerRecord {
    flowId: string;
    class?: string;
    scope?: string;
    source?: string;
    propagation?: string;
    sink?: string;
    judgement?: string;
    query?: FlowQuery;
}

export interface ExpectedFlowGapReportOptions {
    project: string;
    ledgerPath: string;
    runDir: string;
    sourceRoot?: string;
    outputDir?: string;
    manualOverlayPath?: string;
}

export type RawFlowManualVerdict =
    | "confirmed_expected_hit"
    | "candidate_expected_not_countable"
    | "expected_family_or_ledger_variant_not_countable"
    | "out_of_scope_valid_or_low_value"
    | "strict_false_positive"
    | "duplicate"
    | "requires_manual_review";

export type RawFlowManualCountability =
    | "countable"
    | "uncountable"
    | "ledger_outside_noise"
    | "false_positive"
    | "duplicate"
    | "requires_manual_review";

export type RawFlowManualClassification =
    | "confirmed_hit"
    | "near_hit_uncountable"
    | "ledger_outside_noise"
    | "false_positive"
    | "duplicate"
    | "requires_manual_review";

export type ExpectedFlowManualVerdict =
    | "hit"
    | "near_hit_not_countable"
    | "miss_identity"
    | "miss_asset"
    | "miss_reachability"
    | "miss_endpoint"
    | "miss_propagation"
    | "miss_result"
    | "ledger_correction";

export type ExpectedFlowReviewVerdict = ExpectedFlowManualVerdict | "requires_manual_review";

export type ExpectedFlowGapCategory =
    | "identity"
    | "asset"
    | "endpoint"
    | "reachability"
    | "propagation"
    | "result"
    | "ledger_correction"
    | "none"
    | "unknown";

type LayerCheckStatus = "pass" | "gap" | "unknown" | "not_applicable";

interface FlowAnchor {
    role: "source" | "propagation" | "sink";
    raw?: string;
    tokens: string[];
    apiLikeTokens: string[];
    codeTokens: string[];
}

interface ArtifactMatch {
    artifact: string;
    score: number;
    matchedTerms: string[];
    id?: string;
    status?: string;
    kind?: string;
    refs?: string[];
    summary: string;
    row?: any;
}

interface LayerDiagnostic {
    category: ExpectedFlowGapCategory;
    status: LayerCheckStatus;
    gapKind?: string;
    evidence: string[];
    matches: ArtifactMatch[];
}

export interface ManualOverlayRawFlowRecord {
    rawFlowId: string;
    rawId: string;
    verdict: RawFlowManualVerdict;
    countability: RawFlowManualCountability;
    classification: RawFlowManualClassification;
    flowId?: string;
    expectedFlowId?: string | null;
    expectedFlowIds: string[];
    manualMapping?: string;
    sourceSite?: string;
    sinkSite?: string;
    traceSkeleton?: string;
    reason?: string;
    manualReason?: string;
    evidenceRefs: string[];
}

export interface ManualOverlayExpectedFlowRecord {
    flowId: string;
    verdict: ExpectedFlowManualVerdict;
    rawIds: string[];
    overlaySource?: "manual_expected_flow" | "raw_flow_confirmed_hit";
    sourceSite?: string;
    sinkSite?: string;
    traceSkeleton?: string;
    manualReason?: string;
}

export interface ManualOverlay {
    path: string;
    format: "json" | "jsonl" | "markdown";
    rawFlows: ManualOverlayRawFlowRecord[];
    expectedFlows: ManualOverlayExpectedFlowRecord[];
}

interface ManualOverlayContext {
    overlay?: ManualOverlay;
    rawFlows: ManualOverlayRawFlowRecord[];
    expectedFlowVerdicts: Map<string, ManualOverlayExpectedFlowRecord>;
    rawFlowsByExpectedFlowId: Map<string, ManualOverlayRawFlowRecord[]>;
    rawFlowVerdictSummary: Record<RawFlowManualVerdict, number>;
}

interface AnalyzeArtifacts {
    summaryJsonPath: string;
    traceGraphPath: string;
    officialOccurrenceLedgerJsonlPath: string;
    endpointResolutionLedgerJsonlPath: string;
    semanticEffectSitesJsonlPath: string;
    endpointResolutionSummaryJsonPath: string;
    sourceReachabilityGapsJsonlPath: string;
    transferSemanticSiteConsumptionJsonlPath: string;
    sanitizerSemanticSiteConsumptionJsonlPath: string;
    moduleSemanticSiteConsumptionJsonlPath: string;
    ordinaryPropagationGapsJsonlPath: string;
    officialCoverageForLlmFilteringJsonPath: string;
}

function readJson(filePath: string): any {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function readJsonIfExists(filePath: string): any | undefined {
    if (!fs.existsSync(filePath)) return undefined;
    return readJson(filePath);
}

function readJsonl(filePath: string): any[] {
    if (!fs.existsSync(filePath)) return [];
    const text = fs.readFileSync(filePath, "utf-8").trim();
    if (!text) return [];
    return text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

function writeJson(filePath: string, value: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
}

function resolveArtifacts(runDir: string): AnalyzeArtifacts {
    const layout = resolveAnalyzeOutputLayout(runDir);
    return {
        summaryJsonPath: layout.summaryJsonPath,
        traceGraphPath: layout.traceGraphJsonPath,
        officialOccurrenceLedgerJsonlPath: layout.officialOccurrenceLedgerJsonlPath,
        endpointResolutionLedgerJsonlPath: layout.endpointResolutionLedgerJsonlPath,
        semanticEffectSitesJsonlPath: layout.semanticEffectSitesJsonlPath,
        endpointResolutionSummaryJsonPath: layout.endpointResolutionSummaryJsonPath,
        sourceReachabilityGapsJsonlPath: layout.sourceReachabilityGapsJsonlPath,
        transferSemanticSiteConsumptionJsonlPath: layout.transferSemanticSiteConsumptionJsonlPath,
        sanitizerSemanticSiteConsumptionJsonlPath: layout.sanitizerSemanticSiteConsumptionJsonlPath,
        moduleSemanticSiteConsumptionJsonlPath: layout.moduleSemanticSiteConsumptionJsonlPath,
        ordinaryPropagationGapsJsonlPath: layout.ordinaryPropagationGapsJsonlPath,
        officialCoverageForLlmFilteringJsonPath: layout.officialCoverageForLlmFilteringJsonPath,
    };
}

function splitMarkdownRow(line: string): string[] {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return [];
    return trimmed.slice(1, -1).split("|").map(cell => cell.trim());
}

function stripMarkdown(value: string | undefined): string | undefined {
    if (!value) return undefined;
    return value
        .replace(/`([^`]+)`/g, "$1")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .trim();
}

const RAW_FLOW_MANUAL_VERDICTS: RawFlowManualVerdict[] = [
    "confirmed_expected_hit",
    "candidate_expected_not_countable",
    "expected_family_or_ledger_variant_not_countable",
    "out_of_scope_valid_or_low_value",
    "strict_false_positive",
    "duplicate",
    "requires_manual_review",
];

const RAW_FLOW_MANUAL_COUNTABILITIES: RawFlowManualCountability[] = [
    "countable",
    "uncountable",
    "ledger_outside_noise",
    "false_positive",
    "duplicate",
    "requires_manual_review",
];

const EXPECTED_FLOW_MANUAL_VERDICTS: ExpectedFlowManualVerdict[] = [
    "hit",
    "near_hit_not_countable",
    "miss_identity",
    "miss_asset",
    "miss_reachability",
    "miss_endpoint",
    "miss_propagation",
    "miss_result",
    "ledger_correction",
];

function emptyRawFlowVerdictSummary(): Record<RawFlowManualVerdict, number> {
    return {
        confirmed_expected_hit: 0,
        candidate_expected_not_countable: 0,
        expected_family_or_ledger_variant_not_countable: 0,
        out_of_scope_valid_or_low_value: 0,
        strict_false_positive: 0,
        duplicate: 0,
        requires_manual_review: 0,
    };
}

function emptyExpectedFlowVerdictSummary(): Record<ExpectedFlowReviewVerdict, number> {
    return {
        hit: 0,
        near_hit_not_countable: 0,
        miss_identity: 0,
        miss_asset: 0,
        miss_reachability: 0,
        miss_endpoint: 0,
        miss_propagation: 0,
        miss_result: 0,
        ledger_correction: 0,
        requires_manual_review: 0,
    };
}

function normalizeVerdictToken(value: unknown): string {
    return String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_");
}

function parseRawFlowManualVerdict(value: unknown, context: string): RawFlowManualVerdict {
    const normalized = normalizeVerdictToken(value);
    if ((RAW_FLOW_MANUAL_VERDICTS as string[]).includes(normalized)) {
        return normalized as RawFlowManualVerdict;
    }
    throw new Error(`invalid raw flow manual verdict in ${context}: ${String(value ?? "")}`);
}

function parseRawFlowManualCountability(value: unknown, context: string): RawFlowManualCountability | undefined {
    if (value === undefined || value === null || String(value).trim().length === 0) return undefined;
    const normalized = normalizeVerdictToken(value);
    if ((RAW_FLOW_MANUAL_COUNTABILITIES as string[]).includes(normalized)) {
        return normalized as RawFlowManualCountability;
    }
    throw new Error(`invalid raw flow manual countability in ${context}: ${String(value ?? "")}`);
}

function countabilityFromRawFlowVerdict(verdict: RawFlowManualVerdict): RawFlowManualCountability {
    switch (verdict) {
        case "confirmed_expected_hit":
            return "countable";
        case "candidate_expected_not_countable":
        case "expected_family_or_ledger_variant_not_countable":
            return "uncountable";
        case "out_of_scope_valid_or_low_value":
            return "ledger_outside_noise";
        case "strict_false_positive":
            return "false_positive";
        case "duplicate":
            return "duplicate";
        case "requires_manual_review":
            return "requires_manual_review";
    }
}

function classificationFromRawFlowVerdict(verdict: RawFlowManualVerdict): RawFlowManualClassification {
    switch (verdict) {
        case "confirmed_expected_hit":
            return "confirmed_hit";
        case "candidate_expected_not_countable":
        case "expected_family_or_ledger_variant_not_countable":
            return "near_hit_uncountable";
        case "out_of_scope_valid_or_low_value":
            return "ledger_outside_noise";
        case "strict_false_positive":
            return "false_positive";
        case "duplicate":
            return "duplicate";
        case "requires_manual_review":
            return "requires_manual_review";
    }
}

function parseOptionalRawFlowManualVerdict(value: unknown, context: string): RawFlowManualVerdict {
    if (value === undefined || value === null || String(value).trim().length === 0) {
        return "requires_manual_review";
    }
    return parseRawFlowManualVerdict(value, context);
}

function parseExpectedFlowManualVerdict(value: unknown, context: string): ExpectedFlowManualVerdict {
    const normalized = normalizeVerdictToken(value);
    if ((EXPECTED_FLOW_MANUAL_VERDICTS as string[]).includes(normalized)) {
        return normalized as ExpectedFlowManualVerdict;
    }
    throw new Error(`invalid expected flow manual verdict in ${context}: ${String(value ?? "")}`);
}

function stringField(row: any, keys: readonly string[]): string | undefined {
    for (const key of keys) {
        const value = row?.[key];
        if (typeof value === "string" && value.trim().length > 0) return stripMarkdown(value);
        if (typeof value === "number" || typeof value === "boolean") return String(value);
    }
    return undefined;
}

function stringArrayField(row: any, keys: readonly string[]): string[] {
    for (const key of keys) {
        const value = row?.[key];
        if (Array.isArray(value)) {
            return uniqueStrings(value.map(item => String(item)));
        }
        if (typeof value === "string" && value.trim().length > 0) {
            return uniqueStrings(value.split(/[,\s]+/g).map(item => item.trim()).filter(Boolean));
        }
    }
    return [];
}

function splitTraceSkeleton(traceSkeleton: string | undefined): { sourceSite?: string; sinkSite?: string } {
    if (!traceSkeleton) return {};
    const parts = traceSkeleton.split(/\s+->\s+/g).map(part => stripMarkdown(part) || "").filter(Boolean);
    if (parts.length === 0) return {};
    return {
        sourceSite: parts[0],
        sinkSite: parts.length > 1 ? parts[parts.length - 1] : undefined,
    };
}

function normalizeOverlayHeader(value: string): string {
    const normalized = (stripMarkdown(value) || "")
        .trim()
        .toLowerCase()
        .replace(/\s*->\s*/g, "_to_")
        .replace(/[^\w\u4e00-\u9fff]+/g, "_")
        .replace(/^_+|_+$/g, "");
    switch (normalized) {
        case "rawflowid":
        case "raw_flow_id":
            return "raw_flow_id";
        case "rawid":
        case "raw_id":
            return "raw_id";
        case "flowid":
        case "flow_id":
            return "flow_id";
        case "expectedflowid":
        case "expected_flow_id":
            return "expected_flow_id";
        case "expectedflowids":
        case "expected_flow_ids":
            return "expected_flow_ids";
        case "manual_mapping":
        case "mapping":
            return "manual_mapping";
        case "manual_verdict":
        case "raw_verdict":
        case "expected_verdict":
        case "verdict":
            return "verdict";
        case "countability":
        case "manual_countability":
            return "countability";
        case "evidence_refs":
        case "evidencerefs":
        case "evidence":
            return "evidence_refs";
        case "manual_reason":
        case "reason":
        case "人工理由":
            return "manual_reason";
        case "source_site":
        case "source":
            return "source_site";
        case "sink_site":
        case "sink":
            return "sink_site";
        case "trace_skeleton":
        case "skeleton":
        case "raw_source_to_raw_sink":
            return "trace_skeleton";
        default:
            return normalized;
    }
}

function rowFromMarkdownCells(header: readonly string[], cells: readonly string[]): any {
    const row: any = {};
    for (let i = 0; i < header.length && i < cells.length; i++) {
        row[header[i]] = stripMarkdown(cells[i]);
    }
    return row;
}

function normalizeRawOverlayRecord(row: any, context: string): ManualOverlayRawFlowRecord {
    const rawId = stringField(row, ["rawFlowId", "raw_flow_id", "rawId", "raw_id", "id"]);
    if (!rawId) throw new Error(`manual raw-flow overlay row is missing raw_id in ${context}`);
    const verdict = parseOptionalRawFlowManualVerdict(
        stringField(row, ["manualVerdict", "manual_verdict", "rawVerdict", "raw_verdict", "verdict"]),
        context,
    );
    const expectedFlowIds = stringArrayField(row, ["expectedFlowIds", "expected_flow_ids", "expectedFlowId", "expected_flow_id"]);
    const countability = parseRawFlowManualCountability(stringField(row, ["countability", "manualCountability", "manual_countability"]), context)
        || countabilityFromRawFlowVerdict(verdict);
    const traceSkeleton = stringField(row, ["traceSkeleton", "trace_skeleton", "raw_source_to_raw_sink"]);
    const sites = splitTraceSkeleton(traceSkeleton);
    const reason = stringField(row, ["reason", "manualReason", "manual_reason"]);
    return {
        rawFlowId: rawId,
        rawId,
        flowId: stringField(row, ["flowId", "flow_id"]),
        verdict,
        countability,
        classification: classificationFromRawFlowVerdict(verdict),
        expectedFlowId: expectedFlowIds.length > 0 ? expectedFlowIds[0] : null,
        expectedFlowIds,
        manualMapping: stringField(row, ["manualMapping", "manual_mapping"]),
        sourceSite: stringField(row, ["sourceSite", "source_site"]) || sites.sourceSite,
        sinkSite: stringField(row, ["sinkSite", "sink_site"]) || sites.sinkSite,
        traceSkeleton,
        reason,
        manualReason: reason,
        evidenceRefs: stringArrayField(row, ["evidenceRefs", "evidence_refs", "evidence"]),
    };
}

function normalizeExpectedOverlayRecord(row: any, context: string): ManualOverlayExpectedFlowRecord {
    const flowId = stringField(row, ["flowId", "flow_id", "expectedFlowId", "expected_flow_id", "id"]);
    if (!flowId) throw new Error(`manual expected-flow overlay row is missing flowId in ${context}`);
    const traceSkeleton = stringField(row, ["traceSkeleton", "trace_skeleton"]);
    const sites = splitTraceSkeleton(traceSkeleton);
    return {
        flowId,
        verdict: parseExpectedFlowManualVerdict(stringField(row, ["expectedVerdict", "expected_verdict", "manualVerdict", "manual_verdict", "verdict"]), context),
        rawIds: stringArrayField(row, ["rawIds", "raw_ids", "rawId", "raw_id"]),
        overlaySource: "manual_expected_flow",
        sourceSite: stringField(row, ["sourceSite", "source_site"]) || sites.sourceSite,
        sinkSite: stringField(row, ["sinkSite", "sink_site"]) || sites.sinkSite,
        traceSkeleton,
        manualReason: stringField(row, ["manualReason", "manual_reason"]),
    };
}

function parseJsonManualOverlay(absPath: string): ManualOverlay {
    const raw = readJson(absPath);
    const rawRows = Array.isArray(raw)
        ? raw.filter((row: any) => row?.rawFlowId || row?.raw_flow_id || row?.rawId || row?.raw_id)
        : raw.rawFlows || raw.raw_flow_verdicts || raw.rawFlowVerdicts || [];
    const expectedRows = Array.isArray(raw)
        ? raw.filter((row: any) => !row?.rawFlowId && !row?.raw_flow_id && !row?.rawId && !row?.raw_id)
        : raw.expectedFlows || raw.expected_flow_verdicts || raw.expectedFlowVerdicts || [];
    return {
        path: absPath,
        format: "json",
        rawFlows: rawRows.map((row: any, index: number) => normalizeRawOverlayRecord(row, `${absPath}:rawFlows[${index}]`)),
        expectedFlows: expectedRows.map((row: any, index: number) => normalizeExpectedOverlayRecord(row, `${absPath}:expectedFlows[${index}]`)),
    };
}

function parseJsonlManualOverlay(absPath: string): ManualOverlay {
    const rows = readJsonl(absPath);
    const rawRows = rows.filter(row => row?.rawFlowId || row?.raw_flow_id || row?.rawId || row?.raw_id);
    const expectedRows = rows.filter(row => !row?.rawFlowId && !row?.raw_flow_id && !row?.rawId && !row?.raw_id);
    return {
        path: absPath,
        format: "jsonl",
        rawFlows: rawRows.map((row: any, index: number) => normalizeRawOverlayRecord(row, `${absPath}:rawFlows[${index}]`)),
        expectedFlows: expectedRows.map((row: any, index: number) => normalizeExpectedOverlayRecord(row, `${absPath}:expectedFlows[${index}]`)),
    };
}

function parseMarkdownManualOverlay(absPath: string): ManualOverlay {
    const lines = fs.readFileSync(absPath, "utf-8").split(/\r?\n/);
    const rawFlows: ManualOverlayRawFlowRecord[] = [];
    const expectedFlows: ManualOverlayExpectedFlowRecord[] = [];
    let header: string[] | undefined;
    let tableKind: "raw" | "expected" | undefined;
    for (const line of lines) {
        const cells = splitMarkdownRow(line);
        if (cells.length === 0) {
            header = undefined;
            tableKind = undefined;
            continue;
        }
        const normalized = cells.map(normalizeOverlayHeader);
        if ((normalized.includes("raw_id") || normalized.includes("raw_flow_id")) && normalized.includes("verdict")) {
            header = normalized;
            tableKind = "raw";
            continue;
        }
        if ((normalized.includes("flow_id") || normalized.includes("expected_flow_id")) && normalized.includes("verdict")) {
            header = normalized;
            tableKind = "expected";
            continue;
        }
        if (!header || !tableKind || cells.every(cell => /^:?-{3,}:?$/.test(cell))) continue;
        if (cells.length !== header.length) continue;
        const row = rowFromMarkdownCells(header, cells);
        if (tableKind === "raw") {
            rawFlows.push(normalizeRawOverlayRecord(row, `${absPath}:raw[${rawFlows.length}]`));
        } else {
            expectedFlows.push(normalizeExpectedOverlayRecord(row, `${absPath}:expected[${expectedFlows.length}]`));
        }
    }
    return {
        path: absPath,
        format: "markdown",
        rawFlows,
        expectedFlows,
    };
}

export function parseManualOverlay(overlayPath: string): ManualOverlay {
    const absPath = path.resolve(overlayPath);
    if (!fs.existsSync(absPath)) {
        throw new Error(`manual overlay does not exist: ${overlayPath}`);
    }
    const lower = absPath.toLowerCase();
    if (lower.endsWith(".json")) return parseJsonManualOverlay(absPath);
    if (lower.endsWith(".jsonl")) return parseJsonlManualOverlay(absPath);
    return parseMarkdownManualOverlay(absPath);
}

function extractCodeSpans(value: string | undefined): string[] {
    if (!value) return [];
    return [...value.matchAll(/`([^`]+)`/g)]
        .map(match => match[1].trim())
        .filter(Boolean);
}

function extractSearchText(value: string | undefined): string | undefined {
    const code = extractCodeSpans(value)[0];
    if (code) return code;
    const stripped = stripMarkdown(value);
    if (!stripped) return undefined;
    return stripped.replace(/^官方\s*/, "").trim();
}

function waypointFromText(value: string | undefined): TraceWaypoint | undefined {
    const text = extractSearchText(value);
    if (!text) return undefined;
    return { valueContains: text };
}

function queryFromRecord(record: ExpectedFlowLedgerRecord): FlowQuery {
    if (record.query) {
        return record.query;
    }
    return {
        id: record.flowId,
        kind: "should-report",
        source: waypointFromText(record.source),
        expectedWaypoints: record.propagation ? [waypointFromText(record.propagation)].filter((item): item is TraceWaypoint => !!item) : undefined,
        sink: waypointFromText(record.sink),
    };
}

const TOKEN_STOP_WORDS = new Set([
    "the",
    "and",
    "or",
    "to",
    "from",
    "into",
    "with",
    "via",
    "by",
    "of",
    "in",
    "on",
    "official",
    "public",
    "source",
    "sink",
    "propagation",
    "normal",
    "business",
    "flow",
    "valid",
    "taint",
    "object",
    "field",
    "value",
    "item",
    "data",
    "param",
    "params",
    "arg",
    "args",
    "官方",
]);

function uniqueStrings(values: readonly string[]): string[] {
    return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function normalizeSearchText(value: unknown): string {
    return String(value ?? "")
        .replace(/\\/g, "/")
        .toLowerCase();
}

function tokenizeText(value: string | undefined): string[] {
    const stripped = stripMarkdown(value) || "";
    const raw = stripped
        .replace(/->/g, " ")
        .replace(/[()[\]{}"'`,;%]+/g, " ")
        .split(/[^A-Za-z0-9_$@./:\-\u4e00-\u9fff]+/g)
        .map(item => item.trim())
        .filter(Boolean);
    const out: string[] = [];
    for (const item of raw) {
        out.push(item);
        if (/[.@/:_-]/.test(item)) {
            out.push(...item.split(/[.@/:_-]+/g));
        }
    }
    return uniqueStrings(out)
        .filter(token => token.length > 1)
        .filter(token => !TOKEN_STOP_WORDS.has(token.toLowerCase()));
}

function isApiLikeToken(token: string, role: FlowAnchor["role"], codeTokens: readonly string[]): boolean {
    const lower = token.toLowerCase();
    if (TOKEN_STOP_WORDS.has(lower)) return false;
    if (codeTokens.includes(token)) return true;
    if (/[.@/:]/.test(token)) return true;
    if (/^[A-Z][A-Za-z0-9_]{2,}$/.test(token)) return true;
    if (role === "sink" && /^[A-Za-z][A-Za-z0-9_]{3,}$/.test(token)) return true;
    return false;
}

function buildFlowAnchors(record: ExpectedFlowLedgerRecord): FlowAnchor[] {
    const inputs: Array<{ role: FlowAnchor["role"]; raw?: string }> = [
        { role: "source", raw: record.source },
        { role: "propagation", raw: record.propagation },
        { role: "sink", raw: record.sink },
    ];
    return inputs.map(input => {
        const codeTokens = uniqueStrings(extractCodeSpans(input.raw).flatMap(tokenizeText));
        const tokens = tokenizeText(input.raw);
        return {
            role: input.role,
            raw: input.raw,
            tokens,
            codeTokens,
            apiLikeTokens: uniqueStrings(tokens.filter(token => isApiLikeToken(token, input.role, codeTokens))),
        };
    });
}

function preferredTerms(anchors: readonly FlowAnchor[], roles?: readonly FlowAnchor["role"][]): string[] {
    const selected = roles ? anchors.filter(anchor => roles.includes(anchor.role)) : [...anchors];
    const apiTerms = uniqueStrings(selected.flatMap(anchor => anchor.apiLikeTokens));
    if (apiTerms.length > 0) return apiTerms;
    return uniqueStrings(selected.flatMap(anchor => anchor.tokens));
}

function termsForArtifactMatching(anchors: readonly FlowAnchor[]): string[] {
    const sinkTerms = preferredTerms(anchors, ["sink"]);
    const sourceTerms = preferredTerms(anchors, ["source"]);
    const propagationTerms = preferredTerms(anchors, ["propagation"]);
    return uniqueStrings([...sinkTerms, ...sourceTerms, ...propagationTerms]);
}

function rowSearchText(row: any): string {
    return normalizeSearchText(JSON.stringify(row));
}

function termMatchesText(text: string, term: string): boolean {
    const normalized = normalizeSearchText(term);
    if (!normalized || TOKEN_STOP_WORDS.has(normalized)) return false;
    if (text.includes(normalized)) return true;
    const parts = normalized.split(/[.@/:_-]+/g).filter(part => part.length > 1 && !TOKEN_STOP_WORDS.has(part));
    if (parts.length > 1 && parts.every(part => text.includes(part))) return true;
    return false;
}

function matchTerms(row: any, terms: readonly string[]): string[] {
    const text = rowSearchText(row);
    return uniqueStrings(terms.filter(term => termMatchesText(text, term)));
}

function matchScoreForTerms(row: any, terms: readonly string[]): { score: number; matchedTerms: string[] } {
    const matchedTerms = matchTerms(row, terms);
    return { score: matchedTerms.length, matchedTerms };
}

function rowKind(row: any): string | undefined {
    return stringValue(row?.recordKind)
        || stringValue(row?.gapKind)
        || stringValue(row?.kind)
        || stringValue(row?.capability);
}

function rowStatus(row: any): string | undefined {
    return stringValue(row?.status)
        || stringValue(row?.reasonCode)
        || stringValue(row?.reason)
        || stringValue(row?.gapKind);
}

function rowId(row: any): string | undefined {
    return stringValue(row?.effectSiteId)
        || stringValue(row?.occurrenceId)
        || stringValue(row?.canonicalApiId)
        || stringValue(row?.effectAssetId)
        || stringValue(row?.ruleId)
        || stringValue(row?.entryName)
        || stringValue(row?.id);
}

function stringValue(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}

function summarizeRow(row: any): string {
    const parts = [
        rowId(row),
        rowStatus(row),
        stringValue(row?.canonicalApiId),
        stringValue(row?.effectAssetId),
        stringValue(row?.capability),
        stringValue(row?.statementText),
        stringValue(row?.anchor?.statementText),
    ].filter((item): item is string => Boolean(item));
    return uniqueStrings(parts).slice(0, 6).join(" | ");
}

function toArtifactMatch(artifact: string, row: any, score: number, matchedTerms: string[]): ArtifactMatch {
    const refs = uniqueStrings([
        rowId(row),
        stringValue(row?.effectSiteId),
        stringValue(row?.occurrenceId),
        stringValue(row?.rawOccurrenceId),
        stringValue(row?.canonicalApiId),
        stringValue(row?.effectAssetId),
        stringValue(row?.bindingId),
        stringValue(row?.effectTemplateId),
        stringValue(row?.endpointBindingRef),
    ].filter((item): item is string => Boolean(item)));
    return {
        artifact,
        score,
        matchedTerms,
        id: rowId(row),
        status: rowStatus(row),
        kind: rowKind(row),
        refs,
        summary: summarizeRow(row),
        row,
    };
}

function selectArtifactMatches(
    artifact: string,
    rows: readonly any[],
    terms: readonly string[],
    limit = 12,
): ArtifactMatch[] {
    if (terms.length === 0 || rows.length === 0) return [];
    return rows
        .map(row => {
            const matched = matchScoreForTerms(row, terms);
            return matched.score > 0 ? toArtifactMatch(artifact, row, matched.score, matched.matchedTerms) : undefined;
        })
        .filter((item): item is ArtifactMatch => !!item)
        .sort((a, b) => b.score - a.score || (a.id || "").localeCompare(b.id || ""))
        .slice(0, limit);
}

function dedupeMatches(matches: readonly ArtifactMatch[]): ArtifactMatch[] {
    const seen = new Set<string>();
    const out: ArtifactMatch[] = [];
    for (const match of matches) {
        const key = `${match.artifact}\u0001${match.id || ""}\u0001${match.status || ""}\u0001${match.summary}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(match);
    }
    return out;
}

function refsFromMatches(matches: readonly ArtifactMatch[]): Set<string> {
    const refs = new Set<string>();
    const add = (value: unknown) => {
        if (typeof value === "string" && value.length > 0) refs.add(value);
    };
    for (const match of matches) {
        for (const ref of match.refs || []) add(ref);
        add(match.id);
        add(match.row?.effectSiteId);
        add(match.row?.occurrenceId);
        add(match.row?.rawOccurrenceId);
        add(match.row?.canonicalApiId);
        add(match.row?.effectAssetId);
        add(match.row?.bindingId);
        add(match.row?.effectTemplateId);
        add(match.row?.endpointBindingRef);
    }
    return refs;
}

function rowMatchesAnyRef(row: any, refs: ReadonlySet<string>): boolean {
    if (refs.size === 0) return false;
    return [
        row?.effectSiteId,
        row?.occurrenceId,
        row?.rawOccurrenceId,
        row?.canonicalApiId,
        row?.effectAssetId,
        row?.bindingId,
        row?.effectTemplateId,
        row?.endpointBindingRef,
    ].some(value => typeof value === "string" && refs.has(value));
}

function selectMatchesByRefs(artifact: string, rows: readonly any[], refs: ReadonlySet<string>, limit = 12): ArtifactMatch[] {
    if (refs.size === 0) return [];
    return rows
        .filter(row => rowMatchesAnyRef(row, refs))
        .slice(0, limit)
        .map(row => toArtifactMatch(artifact, row, 99, []));
}

function isAcceptedOccurrence(match: ArtifactMatch): boolean {
    return match.row?.status === "accepted";
}

function isSemanticGap(match: ArtifactMatch): boolean {
    return String(match.row?.recordKind || "").includes("gap")
        || Boolean(match.row?.gapKind)
        || match.row?.status === "effect_gap";
}

function isSemanticSite(match: ArtifactMatch): boolean {
    return match.row?.recordKind === "semantic_effect_site"
        || (!isSemanticGap(match) && Boolean(match.row?.effectSiteId || match.row?.effectAssetId));
}

function isResolvedEndpointRow(row: any): boolean {
    const status = String(row?.status || "").toLowerCase();
    if (status === "resolved") return true;
    if (row?.materializedExact === true) return true;
    return Array.isArray(row?.nodeIds) && row.nodeIds.length > 0 && !/unresolved|unsupported|fail|missing|gap/.test(status);
}

function isEndpointGapRow(row: any): boolean {
    if (isResolvedEndpointRow(row)) return false;
    const status = String(row?.status || "").toLowerCase();
    return Boolean(status && status !== "unknown");
}

function layerCheck(
    category: ExpectedFlowGapCategory,
    status: LayerCheckStatus,
    evidence: string[],
    matches: ArtifactMatch[] = [],
    gapKind?: string,
): LayerDiagnostic {
    return {
        category,
        status,
        gapKind,
        evidence,
        matches: dedupeMatches(matches).map(match => ({
            artifact: match.artifact,
            score: match.score,
            matchedTerms: match.matchedTerms,
            id: match.id,
            status: match.status,
            kind: match.kind,
            refs: match.refs,
            summary: match.summary,
        })),
    };
}

function buildIdentityCheck(input: {
    officialOccurrenceRows: readonly any[];
    occurrenceArtifactExists: boolean;
    anchors: readonly FlowAnchor[];
}): LayerDiagnostic {
    const terms = termsForArtifactMatching(input.anchors);
    if (terms.length === 0) {
        return layerCheck("identity", "not_applicable", ["No API-like expected-flow terms were extracted for identity comparison."]);
    }
    if (!input.occurrenceArtifactExists) {
        return layerCheck("identity", "unknown", ["official_occurrence_ledger.jsonl is absent."], [], "missing_artifact");
    }
    const matches = selectArtifactMatches("official_occurrence_ledger", input.officialOccurrenceRows, terms);
    const accepted = matches.filter(isAcceptedOccurrence);
    if (accepted.length > 0) {
        return layerCheck("identity", "pass", [`Accepted official occurrence matched terms: ${accepted[0].matchedTerms.join(", ") || accepted[0].id}.`], accepted);
    }
    if (matches.length > 0) {
        return layerCheck("identity", "gap", ["Expected API-like terms matched occurrence rows, but none were accepted."], matches, "official_occurrence_not_accepted");
    }
    return layerCheck("identity", "gap", [`No official occurrence row matched expected API-like terms: ${terms.slice(0, 8).join(", ")}.`], [], "official_occurrence_absent");
}

function buildAssetCheck(input: {
    semanticEffectRows: readonly any[];
    semanticArtifactExists: boolean;
    anchors: readonly FlowAnchor[];
    identityCheck: LayerDiagnostic;
}): LayerDiagnostic {
    if (!input.semanticArtifactExists) {
        return layerCheck("asset", "unknown", ["semantic_effect_sites.jsonl is absent."], [], "missing_artifact");
    }
    const terms = termsForArtifactMatching(input.anchors);
    const refs = refsFromMatches(input.identityCheck.matches as ArtifactMatch[]);
    const matches = dedupeMatches([
        ...selectMatchesByRefs("semantic_effect_sites", input.semanticEffectRows, refs),
        ...selectArtifactMatches("semantic_effect_sites", input.semanticEffectRows, terms),
    ]);
    const siteMatches = matches.filter(isSemanticSite);
    const gapMatches = matches.filter(isSemanticGap);
    if (siteMatches.length > 0) {
        return layerCheck("asset", "pass", [`Semantic effect site matched ${siteMatches[0].id || "expected terms"}.`], siteMatches);
    }
    if (gapMatches.length > 0) {
        const gapKind = gapMatches[0].row?.gapKind || gapMatches[0].row?.reasonCode || "semantic_effect_gap";
        return layerCheck("asset", "gap", [`Semantic effect gap matched expected terms: ${gapKind}.`], gapMatches, String(gapKind));
    }
    if (input.identityCheck.status === "pass") {
        return layerCheck("asset", "gap", ["An accepted official occurrence was found, but no semantic effect site matched it."], [], "accepted_occurrence_without_semantic_effect_site");
    }
    return layerCheck("asset", "unknown", ["No semantic effect evidence matched the expected-flow terms."]);
}

function buildEndpointCheck(input: {
    endpointRows: readonly any[];
    endpointArtifactExists: boolean;
    semanticRows: readonly any[];
    anchors: readonly FlowAnchor[];
    identityCheck: LayerDiagnostic;
    assetCheck: LayerDiagnostic;
}): LayerDiagnostic {
    if (!input.endpointArtifactExists) {
        return layerCheck("endpoint", "unknown", ["endpoint_resolution_ledger.jsonl is absent."], [], "missing_artifact");
    }
    const terms = termsForArtifactMatching(input.anchors);
    const refs = refsFromMatches([
        ...(input.identityCheck.matches as ArtifactMatch[]),
        ...(input.assetCheck.matches as ArtifactMatch[]),
    ]);
    const directMatches = dedupeMatches([
        ...selectMatchesByRefs("endpoint_resolution_ledger", input.endpointRows, refs),
        ...selectArtifactMatches("endpoint_resolution_ledger", input.endpointRows, terms),
    ]);
    const embeddedMatches = input.semanticRows
        .filter(row => row?.endpointResolution && rowMatchesAnyRef(row, refs))
        .map(row => toArtifactMatch("semantic_effect_sites.endpointResolution", row.endpointResolution, 99, []));
    const matches = dedupeMatches([...directMatches, ...embeddedMatches]);
    const resolved = matches.filter(match => isResolvedEndpointRow(match.row));
    if (resolved.length > 0) {
        return layerCheck("endpoint", "pass", [`Endpoint resolution matched ${resolved[0].id || "expected terms"} with status=${resolved[0].status}.`], resolved);
    }
    const gaps = matches.filter(match => isEndpointGapRow(match.row));
    if (gaps.length > 0) {
        const gapKind = gaps[0].row?.status || gaps[0].row?.reason || "endpoint_unresolved";
        return layerCheck("endpoint", "gap", [`Endpoint evidence matched expected terms but was not resolved: ${gapKind}.`], gaps, String(gapKind));
    }
    const assetRows = (input.assetCheck.matches as ArtifactMatch[]).map(match => match.row).filter(Boolean);
    const expectedEndpoint = assetRows.some(row => row?.endpointSpec || row?.endpointBindingRef);
    if (input.assetCheck.status === "pass" && expectedEndpoint) {
        return layerCheck("endpoint", "gap", ["A semantic effect site declares an endpoint, but no endpoint resolution row matched it."], [], "semantic_effect_endpoint_not_resolved");
    }
    return layerCheck("endpoint", "unknown", ["No endpoint resolution evidence matched the expected-flow terms."]);
}

function buildReachabilityCheck(input: {
    sourceReachabilityRows: readonly any[];
    sourceReachabilityArtifactExists: boolean;
    anchors: readonly FlowAnchor[];
    traceGapLayer?: ExpectedFlowGapLayer;
    traceCauseKind?: string;
    traceHit: boolean;
}): LayerDiagnostic {
    if (input.traceHit) {
        return layerCheck("reachability", "pass", ["Trace query reached the expected sink, so reachability was sufficient for this query."]);
    }
    const terms = termsForArtifactMatching(input.anchors);
    const matches = selectArtifactMatches("source_reachability_gaps", input.sourceReachabilityRows, terms);
    if (matches.length > 0) {
        return layerCheck("reachability", "gap", ["Source reachability gap rows matched the expected flow."], matches, "accepted_source_site_excluded_by_reachability");
    }
    if (input.traceGapLayer === "source_reachability" || input.traceCauseKind?.includes("source_seed_allowed_method_not_reached")) {
        return layerCheck("reachability", "gap", ["Trace explanation classified the missing flow as source reachability."], [], input.traceCauseKind || "source_reachability");
    }
    if (!input.sourceReachabilityArtifactExists) {
        return layerCheck("reachability", "unknown", ["source_reachability_gaps.jsonl is absent."], [], "missing_artifact");
    }
    return layerCheck("reachability", "unknown", ["No source reachability gap evidence matched the expected flow."]);
}

function buildPropagationCheck(input: {
    ordinaryRows: readonly any[];
    transferRows: readonly any[];
    sanitizerRows: readonly any[];
    moduleRows: readonly any[];
    anchors: readonly FlowAnchor[];
    traceGapLayer?: ExpectedFlowGapLayer;
    traceCauseKind?: string;
    traceHit: boolean;
}): LayerDiagnostic {
    if (input.traceHit) {
        return layerCheck("propagation", "pass", ["Trace query reached the expected sink."]);
    }
    const traceCategory = mapGapLayerToCategory(input.traceGapLayer);
    if (traceCategory === "propagation") {
        return layerCheck("propagation", "gap", [`Trace explanation classified the miss as ${input.traceGapLayer}.`], [], input.traceCauseKind || input.traceGapLayer);
    }
    const terms = termsForArtifactMatching(input.anchors);
    const matches = dedupeMatches([
        ...selectArtifactMatches("ordinary_propagation_gaps", input.ordinaryRows, terms),
        ...selectArtifactMatches("transfer_semantic_site_consumption", input.transferRows, terms)
            .filter(match => Number(match.row?.resultCount || 0) === 0 || (match.row?.noHitReasons || []).length > 0),
        ...selectArtifactMatches("sanitizer_semantic_site_consumption", input.sanitizerRows, terms),
        ...selectArtifactMatches("module_semantic_site_consumption", input.moduleRows, terms)
            .filter(match => Number(match.row?.totalEmissionCount || 0) === 0),
    ]);
    if (matches.length > 0) {
        return layerCheck("propagation", "gap", ["Propagation/module/consumer diagnostic rows matched the expected flow."], matches, "propagation_or_consumer_gap");
    }
    return layerCheck("propagation", "unknown", ["No propagation diagnostic row matched the expected flow."]);
}

function flattenFlowSummaryRows(summary: any): any[] {
    const rows: any[] = [];
    if (!summary) return rows;
    for (const entry of summary.entries || []) {
        for (const sample of entry.sinkSamples || []) {
            rows.push({
                recordKind: "sink_sample",
                sourceDir: entry.sourceDir,
                entryName: entry.entryName,
                status: entry.status,
                text: sample,
            });
        }
        for (const trace of entry.flowRuleTraces || []) {
            rows.push({
                recordKind: "flow_rule_trace",
                sourceDir: entry.sourceDir,
                entryName: entry.entryName,
                status: entry.status,
                ...trace,
            });
        }
        for (const result of entry.postsolveResults || []) {
            rows.push({
                recordKind: "postsolve_flow",
                sourceDir: entry.sourceDir,
                entryName: entry.entryName,
                status: result.judgement?.kind,
                source: result.flow?.source,
                sinkText: result.flow?.sinkText,
                sinkFactId: result.flow?.sinkFactId,
                primaryReason: result.evidenceSummary?.primaryReason,
                evidenceKinds: result.evidenceSummary?.evidenceKinds,
                materializationStatus: result.report?.witness?.status,
            });
        }
        for (const materialized of entry.materializedTaintFlows || []) {
            rows.push({
                recordKind: "materialized_taint_flow",
                sourceDir: entry.sourceDir,
                entryName: entry.entryName,
                status: materialized.status,
                sinkFactId: materialized.sinkFactId,
                judgement: materialized.judgement,
                incompleteReasons: materialized.incompleteReasons,
                evidenceKinds: materialized.evidenceKinds,
                pathCount: materialized.paths?.length || 0,
            });
        }
    }
    return rows;
}

function buildResultCheck(input: {
    summary: any;
    summaryArtifactExists: boolean;
    anchors: readonly FlowAnchor[];
    traceHit: boolean;
    traceGapLayer?: ExpectedFlowGapLayer;
    traceCauseKind?: string;
}): LayerDiagnostic {
    const terms = termsForArtifactMatching(input.anchors);
    const summaryRows = flattenFlowSummaryRows(input.summary);
    const matches = selectArtifactMatches("flow_summary", summaryRows, terms);
    if (input.traceHit) {
        return layerCheck("result", "pass", ["Trace query reached the expected sink."], matches);
    }
    if (matches.length > 0 && input.traceGapLayer === undefined) {
        return layerCheck("result", "pass", ["Flow summary matched expected terms even though no trace explanation was available."], matches);
    }
    const traceCategory = mapGapLayerToCategory(input.traceGapLayer);
    if (traceCategory === "result") {
        return layerCheck("result", "gap", [`Trace explanation classified the miss as ${input.traceGapLayer}.`], matches, input.traceCauseKind || input.traceGapLayer);
    }
    if (!input.summaryArtifactExists) {
        return layerCheck("result", "unknown", ["summary/summary.json is absent."], [], "missing_artifact");
    }
    const totalFlows = Number(input.summary?.summary?.totalFlows || 0);
    if (totalFlows === 0) {
        return layerCheck("result", "gap", ["Analyze flow summary reports totalFlows=0."], matches, "no_reported_flows");
    }
    if (matches.length === 0) {
        return layerCheck("result", "gap", ["Analyze reported flows, but no flow-summary row matched the expected flow terms."], [], "expected_flow_not_in_summary");
    }
    return layerCheck("result", "unknown", ["Flow summary evidence was inconclusive for this expected flow."], matches);
}

function mapGapLayerToCategory(layer: ExpectedFlowGapLayer | undefined): ExpectedFlowGapCategory {
    switch (layer) {
        case "identity":
            return "identity";
        case "asset":
        case "effect_site":
            return "asset";
        case "endpoint":
            return "endpoint";
        case "source_reachability":
            return "reachability";
        case "ordinary_propagation":
        case "transfer_scheduler":
        case "module_scheduler":
        case "sanitizer_guard":
        case "sink_not_tainted":
            return "propagation";
        case "materialization":
            return "result";
        case "ledger_correction":
            return "ledger_correction";
        default:
            return "unknown";
    }
}

function chooseGapCategory(input: {
    hit: boolean;
    gapLayer?: ExpectedFlowGapLayer;
    checks: readonly LayerDiagnostic[];
}): ExpectedFlowGapCategory {
    if (input.hit) return "none";
    const mapped = mapGapLayerToCategory(input.gapLayer);
    for (const category of ["identity", "asset", "endpoint"] as ExpectedFlowGapCategory[]) {
        if (input.checks.find(check => check.category === category && check.status === "gap")) {
            return category;
        }
    }
    for (const category of ["reachability", "propagation", "result"] as ExpectedFlowGapCategory[]) {
        if (input.checks.find(check => check.category === category && check.status === "gap")) {
            return category;
        }
    }
    if (mapped !== "unknown") return mapped;
    return "unknown";
}

function linkedExpectedFlowIds(rawFlow: ManualOverlayRawFlowRecord, ledgerFlowIds: readonly string[]): string[] {
    const explicit = rawFlow.expectedFlowIds.filter(flowId => ledgerFlowIds.includes(flowId));
    return uniqueStrings(explicit);
}

function rawFlowReference(rawFlow: ManualOverlayRawFlowRecord): any {
    return {
        rawFlowId: rawFlow.rawFlowId,
        rawId: rawFlow.rawId,
        flowId: rawFlow.flowId,
        expectedFlowId: rawFlow.expectedFlowId,
        verdict: rawFlow.verdict,
        countability: rawFlow.countability,
        classification: rawFlow.classification,
        expectedFlowIds: rawFlow.expectedFlowIds,
        sourceSite: rawFlow.sourceSite,
        sinkSite: rawFlow.sinkSite,
        traceSkeleton: rawFlow.traceSkeleton,
        reason: rawFlow.reason || rawFlow.manualReason,
        manualReason: rawFlow.manualReason,
        evidenceRefs: rawFlow.evidenceRefs,
    };
}

function mergeExpectedOverlayRecord(
    target: Map<string, ManualOverlayExpectedFlowRecord>,
    record: ManualOverlayExpectedFlowRecord,
    context: string,
): void {
    const existing = target.get(record.flowId);
    if (!existing) {
        target.set(record.flowId, { ...record, rawIds: uniqueStrings(record.rawIds || []) });
        return;
    }
    if (existing.verdict !== record.verdict) {
        throw new Error(`conflicting expected-flow manual verdict for ${record.flowId} in ${context}: ${existing.verdict} vs ${record.verdict}`);
    }
    target.set(record.flowId, {
        ...existing,
        rawIds: uniqueStrings([...(existing.rawIds || []), ...(record.rawIds || [])]),
        sourceSite: existing.sourceSite || record.sourceSite,
        sinkSite: existing.sinkSite || record.sinkSite,
        traceSkeleton: existing.traceSkeleton || record.traceSkeleton,
        manualReason: existing.manualReason || record.manualReason,
        overlaySource: existing.overlaySource || record.overlaySource,
    });
}

function buildManualOverlayContext(
    overlay: ManualOverlay | undefined,
    ledgerRecords: readonly ExpectedFlowLedgerRecord[],
): ManualOverlayContext {
    const rawFlowVerdictSummary = emptyRawFlowVerdictSummary();
    if (!overlay) {
        return {
            rawFlows: [],
            expectedFlowVerdicts: new Map(),
            rawFlowsByExpectedFlowId: new Map(),
            rawFlowVerdictSummary,
        };
    }

    const ledgerFlowIds = ledgerRecords.map(record => record.flowId);
    const expectedFlowVerdicts = new Map<string, ManualOverlayExpectedFlowRecord>();
    const rawFlowsByExpectedFlowId = new Map<string, ManualOverlayRawFlowRecord[]>();

    for (const expectedFlow of overlay.expectedFlows) {
        mergeExpectedOverlayRecord(expectedFlowVerdicts, expectedFlow, overlay.path);
    }

    const normalizedRawFlows = overlay.rawFlows.map(rawFlow => {
        const expectedFlowIds = linkedExpectedFlowIds(rawFlow, ledgerFlowIds);
        return {
            ...rawFlow,
            expectedFlowId: expectedFlowIds.length > 0 ? expectedFlowIds[0] : null,
            expectedFlowIds,
        };
    });

    for (const rawFlow of normalizedRawFlows) {
        rawFlowVerdictSummary[rawFlow.verdict]++;
        for (const flowId of rawFlow.expectedFlowIds) {
            const flows = rawFlowsByExpectedFlowId.get(flowId) || [];
            flows.push(rawFlow);
            rawFlowsByExpectedFlowId.set(flowId, flows);
        }
        if (rawFlow.verdict !== "confirmed_expected_hit") continue;
        for (const flowId of rawFlow.expectedFlowIds) {
            mergeExpectedOverlayRecord(expectedFlowVerdicts, {
                flowId,
                verdict: "hit",
                rawIds: [rawFlow.rawId],
                overlaySource: "raw_flow_confirmed_hit",
                sourceSite: rawFlow.sourceSite,
                sinkSite: rawFlow.sinkSite,
                traceSkeleton: rawFlow.traceSkeleton,
                manualReason: rawFlow.manualReason,
            }, overlay.path);
        }
    }

    return {
        overlay,
        rawFlows: normalizedRawFlows,
        expectedFlowVerdicts,
        rawFlowsByExpectedFlowId,
        rawFlowVerdictSummary,
    };
}

function expectedVerdictFromAutomatedResult(traceHit: boolean, gapCategory: ExpectedFlowGapCategory): ExpectedFlowReviewVerdict {
    if (traceHit) return "hit";
    switch (gapCategory) {
        case "identity":
            return "miss_identity";
        case "asset":
            return "miss_asset";
        case "endpoint":
            return "miss_endpoint";
        case "reachability":
            return "miss_reachability";
        case "propagation":
            return "miss_propagation";
        case "result":
            return "miss_result";
        case "ledger_correction":
            return "ledger_correction";
        default:
            return "requires_manual_review";
    }
}

function statusFromExpectedFlowVerdict(verdict: ExpectedFlowReviewVerdict): string {
    if (verdict === "hit") return "hit";
    if (verdict === "near_hit_not_countable") return "near_hit_not_countable";
    if (verdict === "ledger_correction") return "ledger_correction";
    if (verdict === "requires_manual_review") return "requires_manual_review";
    return "miss";
}

function gapCategoryFromExpectedFlowVerdict(verdict: ExpectedFlowReviewVerdict, provisional: ExpectedFlowGapCategory): ExpectedFlowGapCategory {
    switch (verdict) {
        case "hit":
            return "none";
        case "near_hit_not_countable":
            return provisional;
        case "miss_identity":
            return "identity";
        case "miss_asset":
            return "asset";
        case "miss_endpoint":
            return "endpoint";
        case "miss_reachability":
            return "reachability";
        case "miss_propagation":
            return "propagation";
        case "miss_result":
            return "result";
        case "ledger_correction":
            return "ledger_correction";
        case "requires_manual_review":
            return provisional;
    }
}

function gapLayerFromExpectedFlowVerdict(
    verdict: ExpectedFlowReviewVerdict,
    provisional: ExpectedFlowGapLayer | undefined,
): ExpectedFlowGapLayer | undefined {
    switch (verdict) {
        case "hit":
            return undefined;
        case "near_hit_not_countable":
            return provisional;
        case "miss_identity":
            return "identity";
        case "miss_asset":
            return "asset";
        case "miss_endpoint":
            return "endpoint";
        case "miss_reachability":
            return "source_reachability";
        case "miss_propagation":
            return "ordinary_propagation";
        case "miss_result":
            return "materialization";
        case "ledger_correction":
            return "ledger_correction";
        case "requires_manual_review":
            return provisional;
    }
}

function applyManualOverlayEvaluation(record: any, context: ManualOverlayContext): any {
    const automatedStatus = record.status;
    const automatedGapCategory = record.gapCategory as ExpectedFlowGapCategory;
    const automatedGapLayer = record.gapLayer as ExpectedFlowGapLayer | undefined;
    const automatedExpectedFlowVerdict = expectedVerdictFromAutomatedResult(automatedStatus === "hit", automatedGapCategory);
    const overlayRecord = context.expectedFlowVerdicts.get(record.flowId);
    const rawFlowRefs = context.rawFlowsByExpectedFlowId.get(record.flowId) || [];
    const rawFlowRefsByRawId = new Map(rawFlowRefs.map(rawFlow => [rawFlow.rawId, rawFlow]));
    const expectedFlowVerdict: ExpectedFlowReviewVerdict = overlayRecord?.verdict || "requires_manual_review";
    const countedRawFlowRefs = expectedFlowVerdict === "hit" ? (overlayRecord?.rawIds || []).map(rawId => {
        const rawFlow = rawFlowRefsByRawId.get(rawId);
        return rawFlow ? rawFlowReference(rawFlow) : { rawId };
    }) : [];
    return {
        ...record,
        automatedStatus,
        automatedTraceVerdict: record.verdict,
        automatedExpectedFlowVerdict,
        automatedGapCategory,
        automatedGapLayer,
        status: statusFromExpectedFlowVerdict(expectedFlowVerdict),
        gapCategory: gapCategoryFromExpectedFlowVerdict(expectedFlowVerdict, automatedGapCategory),
        gapLayer: gapLayerFromExpectedFlowVerdict(expectedFlowVerdict, automatedGapLayer),
        expectedFlowVerdict,
        expectedFlowVerdictSource: overlayRecord
            ? overlayRecord.overlaySource || "manual_expected_flow"
            : context.overlay
                ? "manual_overlay_missing_record"
                : "manual_overlay_absent",
        requiresManualReview: expectedFlowVerdict === "requires_manual_review",
        manualOverlay: overlayRecord ? {
            flowId: overlayRecord.flowId,
            verdict: overlayRecord.verdict,
            rawIds: overlayRecord.rawIds,
            sourceSite: overlayRecord.sourceSite,
            sinkSite: overlayRecord.sinkSite,
            traceSkeleton: overlayRecord.traceSkeleton,
            manualReason: overlayRecord.manualReason,
        } : undefined,
        countedRawFlowRefs,
        rawFlowRefs: rawFlowRefs.map(rawFlowReference),
    };
}

export function parseExpectedFlowLedger(ledgerPath: string): ExpectedFlowLedgerRecord[] {
    const abs = path.resolve(ledgerPath);
    const text = fs.readFileSync(abs, "utf-8");
    if (abs.toLowerCase().endsWith(".json")) {
        const raw = JSON.parse(text);
        const rows = Array.isArray(raw) ? raw : raw.flows || raw.records || raw.queries;
        if (!Array.isArray(rows)) {
            throw new Error(`expected-flow JSON must be an array or contain flows/records/queries: ${ledgerPath}`);
        }
        return rows.map((row: any, index: number) => ({
            flowId: String(row.flowId || row.flow_id || row.id || `flow_${index + 1}`),
            class: row.class,
            scope: row.scope,
            source: row.source,
            propagation: row.propagation,
            sink: row.sink,
            judgement: row.judgement,
            query: row.query || (row.kind ? row : undefined),
        }));
    }

    const lines = text.split(/\r?\n/);
    let header: string[] | undefined;
    const records: ExpectedFlowLedgerRecord[] = [];
    for (const line of lines) {
        const cells = splitMarkdownRow(line);
        if (cells.length === 0) continue;
        const normalized = cells.map(cell => cell.toLowerCase().replace(/-/g, "_"));
        if (normalized.includes("flow_id")) {
            header = normalized;
            continue;
        }
        if (!header || cells.every(cell => /^:?-{3,}:?$/.test(cell))) continue;
        if (cells.length !== header.length) continue;
        const get = (name: string): string | undefined => {
            const index = header!.indexOf(name);
            return index >= 0 ? stripMarkdown(cells[index]) : undefined;
        };
        const flowId = get("flow_id");
        if (!flowId) continue;
        records.push({
            flowId,
            class: get("class"),
            scope: get("scope"),
            source: get("source"),
            propagation: get("propagation"),
            sink: get("sink"),
            judgement: get("judgement"),
        });
    }
    return records;
}

function mapCauseToGapLayer(causeKind: string | undefined, primaryLayer: string | undefined): ExpectedFlowGapLayer {
    const cause = causeKind || "";
    if (cause === "trace.source_ambiguous") return "ledger_correction";
    if (cause.includes("coverage.") || cause.includes("asset.")) return "asset";
    if (cause.includes("source_seed_allowed_method_not_reached")) return "source_reachability";
    if (cause.includes("module.")) return "module_scheduler";
    if (cause.includes("ordinary.")) return "ordinary_propagation";
    if (cause.includes("sink.")) return "sink_not_tainted";
    if (cause.includes("provenance.") || cause.includes("reporting.") || cause.includes("postsolve.")) return "materialization";
    switch (primaryLayer) {
        case "preanalysis":
        case "coverage_ledger":
        case "semanticflow":
        case "semanticflow_llm":
        case "asset_validation":
        case "asset_promotion":
        case "asset_lowering":
            return "asset";
        case "source_seed":
        case "entry_recovery":
            return "source_reachability";
        case "module":
        case "module_lowering":
            return "module_scheduler";
        case "ordinary":
        case "OCLFS":
        case "UDE":
            return "ordinary_propagation";
        case "sink":
        case "sink_candidate":
            return "sink_not_tainted";
        case "provenance":
        case "reporting":
        case "postsolve":
            return "materialization";
        case "rule":
            return "effect_site";
        default:
            return "effect_site";
    }
}

function summarizeByGapLayer(records: readonly any[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const record of records) {
        if (!record.gapLayer) continue;
        out[record.gapLayer] = (out[record.gapLayer] || 0) + 1;
    }
    return out;
}

function summarizeByGapCategory(records: readonly any[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const record of records) {
        const category = record.gapCategory || "unknown";
        if (category === "none") continue;
        out[category] = (out[category] || 0) + 1;
    }
    return out;
}

function summarizeByExpectedFlowVerdict(records: readonly any[]): Record<ExpectedFlowReviewVerdict, number> {
    const out = emptyExpectedFlowVerdictSummary();
    for (const record of records) {
        const verdict = record.expectedFlowVerdict as ExpectedFlowReviewVerdict | undefined;
        if (!verdict) continue;
        out[verdict]++;
    }
    return out;
}

function summarizeAutomatedByExpectedFlowVerdict(records: readonly any[]): Record<ExpectedFlowReviewVerdict, number> {
    const out = emptyExpectedFlowVerdictSummary();
    for (const record of records) {
        const verdict = record.automatedExpectedFlowVerdict as ExpectedFlowReviewVerdict | undefined;
        if (!verdict) continue;
        out[verdict]++;
    }
    return out;
}

function summarizeManualReviewOutcome(
    records: readonly any[],
    rawFlowVerdictSummary: Record<RawFlowManualVerdict, number>,
): Record<string, number> {
    return {
        confirmedHit: records.filter(record => record.status === "hit").length,
        miss: records.filter(record => record.status === "miss").length,
        nearHitNotCountable: records.filter(record => record.status === "near_hit_not_countable").length,
        nearHitUncountableRaw: rawFlowVerdictSummary.candidate_expected_not_countable
            + rawFlowVerdictSummary.expected_family_or_ledger_variant_not_countable,
        ledgerOutsideNoise: rawFlowVerdictSummary.out_of_scope_valid_or_low_value,
        falsePositive: rawFlowVerdictSummary.strict_false_positive,
        outOfScope: rawFlowVerdictSummary.out_of_scope_valid_or_low_value,
        strictFalsePositive: rawFlowVerdictSummary.strict_false_positive,
        duplicate: rawFlowVerdictSummary.duplicate,
        requiresManualReview: records.filter(record => record.status === "requires_manual_review").length
            + rawFlowVerdictSummary.requires_manual_review,
    };
}

function summarizeRawFlowClassification(rawFlows: readonly ManualOverlayRawFlowRecord[]): Record<RawFlowManualClassification, number> {
    const out: Record<RawFlowManualClassification, number> = {
        confirmed_hit: 0,
        near_hit_uncountable: 0,
        ledger_outside_noise: 0,
        false_positive: 0,
        duplicate: 0,
        requires_manual_review: 0,
    };
    for (const rawFlow of rawFlows) {
        out[rawFlow.classification]++;
    }
    return out;
}

function summarizeChecks(checks: readonly LayerDiagnostic[] | undefined): string {
    if (!checks || checks.length === 0) return "";
    const relevant = checks.filter(check => check.status === "gap" || check.status === "pass");
    return relevant
        .map(check => `${check.category}:${check.status}${check.gapKind ? `/${check.gapKind}` : ""}`)
        .join("<br>");
}

function renderMarkdownReport(report: any): string {
    const lines = [
        "# Expected Flow Gap Report",
        "",
        `Project: ${report.project}`,
        `Ledger: ${report.ledgerPath}`,
        `Run: ${report.runDir}`,
        `Evaluation status: ${report.evaluationStatus}`,
        `Requires manual review: ${report.requiresManualReview}`,
        `Manual overlay: ${report.manualOverlay.status}`,
        "",
        `Total: ${report.summary.total}`,
        `Final hit: ${report.summary.hit}`,
        `Final miss: ${report.summary.miss}`,
        `Near-hit not countable: ${report.summary.nearHitNotCountable}`,
        `Requires manual review: ${report.summary.requiresManualReview}`,
        `Automated provisional hit: ${report.summary.automated.hit}`,
        `Automated provisional miss: ${report.summary.automated.miss}`,
        "",
        "| flow_id | status | expectedVerdict | verdictSource | gapCategory | automatedStatus | automatedVerdict | countedRawRefs | relatedRawRefs | checks | evidence |",
        "|---|---|---|---|---|---|---|---|---|---|---|",
    ];
    for (const record of report.records) {
        const evidence = (record.evidence || []).slice(0, 2).join("<br>").replace(/\|/g, "\\|");
        const checks = summarizeChecks(record.checks).replace(/\|/g, "\\|");
        const rawRefs = (record.rawFlowRefs || [])
            .map((rawFlow: any) => `${rawFlow.rawId}:${rawFlow.verdict}`)
            .join("<br>")
            .replace(/\|/g, "\\|");
        const countedRawRefs = (record.countedRawFlowRefs || [])
            .map((rawFlow: any) => `${rawFlow.rawId}${rawFlow.verdict ? `:${rawFlow.verdict}` : ""}`)
            .join("<br>")
            .replace(/\|/g, "\\|");
        lines.push(`| ${record.flowId} | ${record.status} | ${record.expectedFlowVerdict || ""} | ${record.expectedFlowVerdictSource || ""} | ${record.gapCategory || ""} | ${record.automatedStatus || ""} | ${record.automatedExpectedFlowVerdict || ""} | ${countedRawRefs} | ${rawRefs} | ${checks} | ${evidence} |`);
    }
    if (report.rawFlowVerdictSummary) {
        lines.push("", "## Raw Flow Verdict Summary", "");
        for (const [key, value] of Object.entries(report.rawFlowVerdictSummary)) {
            lines.push(`- ${key}: ${value}`);
        }
    }
    if (report.rawFlowClassificationSummary) {
        lines.push("", "## Raw Flow Classification Summary", "");
        for (const [key, value] of Object.entries(report.rawFlowClassificationSummary)) {
            lines.push(`- ${key}: ${value}`);
        }
    }
    if (report.summary.manualReviewOutcome) {
        lines.push("", "## Manual Review Outcome Summary", "");
        for (const [key, value] of Object.entries(report.summary.manualReviewOutcome)) {
            lines.push(`- ${key}: ${value}`);
        }
    }
    if (report.summary.byExpectedFlowVerdict) {
        lines.push("", "## Expected Flow Verdict Summary", "");
        for (const [key, value] of Object.entries(report.summary.byExpectedFlowVerdict)) {
            lines.push(`- ${key}: ${value}`);
        }
    }
    if (report.pendingFields.length > 0) {
        lines.push("", "## Pending Fields", "", ...report.pendingFields.map((field: string) => `- ${field}`));
    }
    lines.push("", "## Inputs", "");
    for (const [key, value] of Object.entries(report.inputs || {})) {
        lines.push(`- ${key}: ${value}`);
    }
    return `${lines.join("\n")}\n`;
}

export function generateExpectedFlowGapReport(options: ExpectedFlowGapReportOptions): any {
    const ledgerPath = path.resolve(options.ledgerPath);
    const runDir = path.resolve(options.runDir);
    const outputDir = path.resolve(options.outputDir || path.join(runDir, "audit"));
    const artifacts = resolveArtifacts(runDir);
    const ledgerRecords = parseExpectedFlowLedger(ledgerPath);
    const manualOverlay = options.manualOverlayPath ? parseManualOverlay(options.manualOverlayPath) : undefined;
    const manualOverlayContext = buildManualOverlayContext(manualOverlay, ledgerRecords);
    const queries = ledgerRecords.map(queryFromRecord);
    const summary = readJsonIfExists(artifacts.summaryJsonPath);
    const officialOccurrenceRows = readJsonl(artifacts.officialOccurrenceLedgerJsonlPath);
    const endpointRows = readJsonl(artifacts.endpointResolutionLedgerJsonlPath);
    const semanticSites = readJsonl(artifacts.semanticEffectSitesJsonlPath);
    const endpointSummary = fs.existsSync(artifacts.endpointResolutionSummaryJsonPath)
        ? readJson(artifacts.endpointResolutionSummaryJsonPath)
        : buildEndpointResolutionSummary(endpointRows, semanticSites);
    const sourceReachabilityRows = readJsonl(artifacts.sourceReachabilityGapsJsonlPath);
    const transferConsumptionRows = readJsonl(artifacts.transferSemanticSiteConsumptionJsonlPath);
    const sanitizerConsumptionRows = readJsonl(artifacts.sanitizerSemanticSiteConsumptionJsonlPath);
    const moduleConsumptionRows = readJsonl(artifacts.moduleSemanticSiteConsumptionJsonlPath);
    const ordinaryPropagationRows = readJsonl(artifacts.ordinaryPropagationGapsJsonlPath);
    const graph = fs.existsSync(artifacts.traceGraphPath)
        ? readJson(artifacts.traceGraphPath) as TraceGraph
        : undefined;
    const artifactExists = {
        summary: fs.existsSync(artifacts.summaryJsonPath),
        officialOccurrenceLedger: fs.existsSync(artifacts.officialOccurrenceLedgerJsonlPath),
        endpointResolutionLedger: fs.existsSync(artifacts.endpointResolutionLedgerJsonlPath),
        semanticEffectSites: fs.existsSync(artifacts.semanticEffectSitesJsonlPath),
        sourceReachabilityGaps: fs.existsSync(artifacts.sourceReachabilityGapsJsonlPath),
        transferSemanticSiteConsumption: fs.existsSync(artifacts.transferSemanticSiteConsumptionJsonlPath),
        sanitizerSemanticSiteConsumption: fs.existsSync(artifacts.sanitizerSemanticSiteConsumptionJsonlPath),
        moduleSemanticSiteConsumption: fs.existsSync(artifacts.moduleSemanticSiteConsumptionJsonlPath),
        ordinaryPropagationGaps: fs.existsSync(artifacts.ordinaryPropagationGapsJsonlPath),
        traceGraph: fs.existsSync(artifacts.traceGraphPath),
    };
    const pendingFields = new Set<string>();
    for (const site of semanticSites) {
        for (const field of site.pendingFields || []) pendingFields.add(String(field));
    }
    for (const field of endpointSummary.pendingFields || []) pendingFields.add(String(field));
    if (!graph) {
        for (const field of C2_C3_PENDING_CONSUMER_FIELDS) pendingFields.add(field);
    }

    const explainedResults = graph
        ? explainTraceResults(
            graph,
            queries,
            queryTraceGraphMany(graph, queries),
            {
                projectRoot: options.project,
                sourceRoot: options.sourceRoot,
            },
        )
        : [];

    const records = ledgerRecords.map((record, index) => {
        const result = explainedResults[index];
        const query = queries[index];
        const anchors = buildFlowAnchors(record);
        const traceHit = Boolean(result && result.verdict === "reached");
        const explanation = result?.explanation;
        const gapLayer = traceHit
            ? undefined
            : result
                ? mapCauseToGapLayer(explanation?.causeKind, explanation?.primaryLayer)
                : "effect_site" as ExpectedFlowGapLayer;
        const identityCheck = buildIdentityCheck({
            officialOccurrenceRows,
            occurrenceArtifactExists: artifactExists.officialOccurrenceLedger,
            anchors,
        });
        const assetCheck = buildAssetCheck({
            semanticEffectRows: semanticSites,
            semanticArtifactExists: artifactExists.semanticEffectSites,
            anchors,
            identityCheck,
        });
        const endpointCheck = buildEndpointCheck({
            endpointRows,
            endpointArtifactExists: artifactExists.endpointResolutionLedger,
            semanticRows: semanticSites,
            anchors,
            identityCheck,
            assetCheck,
        });
        const reachabilityCheck = buildReachabilityCheck({
            sourceReachabilityRows,
            sourceReachabilityArtifactExists: artifactExists.sourceReachabilityGaps,
            anchors,
            traceGapLayer: gapLayer,
            traceCauseKind: explanation?.causeKind,
            traceHit,
        });
        const propagationCheck = buildPropagationCheck({
            ordinaryRows: ordinaryPropagationRows,
            transferRows: transferConsumptionRows,
            sanitizerRows: sanitizerConsumptionRows,
            moduleRows: moduleConsumptionRows,
            anchors,
            traceGapLayer: gapLayer,
            traceCauseKind: explanation?.causeKind,
            traceHit,
        });
        const resultCheck = buildResultCheck({
            summary,
            summaryArtifactExists: artifactExists.summary,
            anchors,
            traceHit,
            traceGapLayer: gapLayer,
            traceCauseKind: explanation?.causeKind,
        });
        const checks = [
            identityCheck,
            assetCheck,
            endpointCheck,
            reachabilityCheck,
            propagationCheck,
            resultCheck,
        ];
        const gapCategory = chooseGapCategory({
            hit: traceHit,
            gapLayer,
            checks,
        });
        if (!result) {
            return applyManualOverlayEvaluation({
                flowId: record.flowId,
                class: record.class,
                scope: record.scope,
                status: "miss",
                gapCategory,
                gapLayer,
                verdict: "unresolved",
                query,
                anchors,
                checks,
                evidence: ["full_trace_graph.json is absent; C2/C3 consumer fields are required for precise attribution."],
                pendingFields: [...pendingFields].sort(),
            }, manualOverlayContext);
        }
        return applyManualOverlayEvaluation({
            flowId: record.flowId,
            class: record.class,
            scope: record.scope,
            status: traceHit ? "hit" : "miss",
            gapCategory,
            gapLayer,
            verdict: result.verdict,
            query,
            anchors,
            checks,
            causeKind: explanation?.causeKind,
            reason: explanation?.reason,
            evidence: explanation?.evidence || result.evidenceChain,
            pendingFields: [...pendingFields].sort(),
        }, manualOverlayContext);
    });

    const requiresManualReview = records.some(record => record.requiresManualReview);
    const evaluationStatus = !manualOverlay
        ? "provisional"
        : requiresManualReview
            ? "requires_manual_review"
            : "final";

    const report = {
        format: "arktaint-expected-flow-gap-report",
        generatedAt: new Date().toISOString(),
        evaluationStatus,
        requiresManualReview,
        project: options.project,
        ledgerPath,
        runDir,
        sourceRoot: options.sourceRoot ? path.resolve(options.sourceRoot) : undefined,
        inputs: {
            summaryJson: artifacts.summaryJsonPath,
            traceGraph: artifacts.traceGraphPath,
            officialOccurrenceLedgerJsonl: artifacts.officialOccurrenceLedgerJsonlPath,
            endpointResolutionLedgerJsonl: artifacts.endpointResolutionLedgerJsonlPath,
            semanticEffectSitesJsonl: artifacts.semanticEffectSitesJsonlPath,
            endpointResolutionSummaryJson: artifacts.endpointResolutionSummaryJsonPath,
            sourceReachabilityGapsJsonl: artifacts.sourceReachabilityGapsJsonlPath,
            transferSemanticSiteConsumptionJsonl: artifacts.transferSemanticSiteConsumptionJsonlPath,
            sanitizerSemanticSiteConsumptionJsonl: artifacts.sanitizerSemanticSiteConsumptionJsonlPath,
            moduleSemanticSiteConsumptionJsonl: artifacts.moduleSemanticSiteConsumptionJsonlPath,
            ordinaryPropagationGapsJsonl: artifacts.ordinaryPropagationGapsJsonlPath,
            officialCoverageForLlmFilteringJson: artifacts.officialCoverageForLlmFilteringJsonPath,
            manualOverlay: manualOverlay?.path,
        },
        manualOverlay: manualOverlay ? {
            status: "present",
            path: manualOverlay.path,
            format: manualOverlay.format,
            rawFlowCount: manualOverlayContext.rawFlows.length,
            expectedFlowCount: manualOverlay.expectedFlows.length,
        } : {
            status: "absent",
        },
        artifactStatus: {
            exists: artifactExists,
            rowCounts: {
                officialOccurrenceLedger: officialOccurrenceRows.length,
                semanticEffectSites: semanticSites.length,
                endpointResolutionLedger: endpointRows.length,
                sourceReachabilityGaps: sourceReachabilityRows.length,
                transferSemanticSiteConsumption: transferConsumptionRows.length,
                sanitizerSemanticSiteConsumption: sanitizerConsumptionRows.length,
                moduleSemanticSiteConsumption: moduleConsumptionRows.length,
                ordinaryPropagationGaps: ordinaryPropagationRows.length,
                flowSummaryRows: flattenFlowSummaryRows(summary).length,
            },
        },
        summary: {
            total: records.length,
            hit: records.filter(record => record.status === "hit").length,
            miss: records.filter(record => record.status === "miss").length,
            nearHitNotCountable: records.filter(record => record.status === "near_hit_not_countable").length,
            ledgerCorrection: records.filter(record => record.status === "ledger_correction").length,
            requiresManualReview: records.filter(record => record.status === "requires_manual_review").length,
            manualReviewOutcome: summarizeManualReviewOutcome(records, manualOverlayContext.rawFlowVerdictSummary),
            byExpectedFlowVerdict: summarizeByExpectedFlowVerdict(records),
            byGapCategory: summarizeByGapCategory(records),
            byGapLayer: summarizeByGapLayer(records),
            automated: {
                hit: records.filter(record => record.automatedStatus === "hit").length,
                miss: records.filter(record => record.automatedStatus === "miss").length,
                byExpectedFlowVerdict: summarizeAutomatedByExpectedFlowVerdict(records),
                byGapCategory: summarizeByGapCategory(records.map(record => ({
                    gapCategory: record.automatedGapCategory,
                }))),
                byGapLayer: summarizeByGapLayer(records.map(record => ({
                    gapLayer: record.automatedGapLayer,
                }))),
            },
        },
        rawFlowVerdictSummary: manualOverlayContext.rawFlowVerdictSummary,
        rawFlowClassificationSummary: summarizeRawFlowClassification(manualOverlayContext.rawFlows),
        pendingFields: [...pendingFields].sort(),
        records,
    };

    writeJson(path.join(outputDir, "expected_flow_gap_report.json"), report);
    fs.writeFileSync(path.join(outputDir, "expected_flow_gap_report.md"), renderMarkdownReport(report), "utf-8");
    return report;
}

function readValue(arg: string, next: string | undefined, key: string): { matched: boolean; value?: string; consume: boolean } {
    if (arg === key) return { matched: true, value: next, consume: true };
    if (arg.startsWith(`${key}=`)) return { matched: true, value: arg.slice(key.length + 1), consume: false };
    return { matched: false, consume: false };
}

function parseArgs(argv: string[]): ExpectedFlowGapReportOptions {
    let project = "";
    let ledgerPath = "";
    let runDir = "";
    let sourceRoot: string | undefined;
    let outputDir: string | undefined;
    let manualOverlayPath: string | undefined;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const next = i + 1 < argv.length ? argv[i + 1] : undefined;
        const projectArg = readValue(arg, next, "--project");
        if (projectArg.matched) {
            project = projectArg.value || "";
            if (projectArg.consume) i++;
            continue;
        }
        const ledgerArg = readValue(arg, next, "--ledgerPath");
        const ledgerAliasArg = readValue(arg, next, "--ledger");
        if (ledgerArg.matched || ledgerAliasArg.matched) {
            const matched = ledgerArg.matched ? ledgerArg : ledgerAliasArg;
            ledgerPath = matched.value || "";
            if (matched.consume) i++;
            continue;
        }
        const runDirArg = readValue(arg, next, "--runDir");
        if (runDirArg.matched) {
            runDir = runDirArg.value || "";
            if (runDirArg.consume) i++;
            continue;
        }
        const sourceRootArg = readValue(arg, next, "--sourceRoot");
        if (sourceRootArg.matched) {
            sourceRoot = sourceRootArg.value;
            if (sourceRootArg.consume) i++;
            continue;
        }
        const outputDirArg = readValue(arg, next, "--outputDir");
        if (outputDirArg.matched) {
            outputDir = outputDirArg.value;
            if (outputDirArg.consume) i++;
            continue;
        }
        const manualOverlayArg = readValue(arg, next, "--manualOverlay");
        const manualOverlayPathArg = readValue(arg, next, "--manualOverlayPath");
        if (manualOverlayArg.matched || manualOverlayPathArg.matched) {
            const matched = manualOverlayArg.matched ? manualOverlayArg : manualOverlayPathArg;
            manualOverlayPath = matched.value;
            if (matched.consume) i++;
            continue;
        }
        throw new Error(`unknown expected_flow_gap_report option: ${arg}`);
    }
    if (!project) throw new Error("missing --project");
    if (!ledgerPath) throw new Error("missing --ledgerPath");
    if (!runDir) throw new Error("missing --runDir");
    return { project, ledgerPath, runDir, sourceRoot, outputDir, manualOverlayPath };
}

export function runExpectedFlowGapReportCli(argv: string[]): void {
    const options = parseArgs(argv);
    const report = generateExpectedFlowGapReport(options);
    const outputDir = path.resolve(options.outputDir || path.join(options.runDir, "audit"));
    console.log(`expected_flow_gap_report_json=${path.join(outputDir, "expected_flow_gap_report.json")}`);
    console.log(`expected_flow_gap_report_md=${path.join(outputDir, "expected_flow_gap_report.md")}`);
    console.log(`expected_flow_total=${report.summary.total}`);
    console.log(`expected_flow_hit=${report.summary.hit}`);
    console.log(`expected_flow_miss=${report.summary.miss}`);
    console.log(`expected_flow_near_hit_not_countable=${report.summary.nearHitNotCountable}`);
    console.log(`expected_flow_requires_manual_review=${report.summary.requiresManualReview}`);
}

if (require.main === module) {
    try {
        runExpectedFlowGapReportCli(process.argv.slice(2));
    } catch (error: any) {
        console.error(error?.message || String(error));
        process.exit(1);
    }
}
