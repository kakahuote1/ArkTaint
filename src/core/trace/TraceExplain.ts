import * as fs from "fs";
import * as path from "path";
import {
    FlowQuery,
    FlowQueryResult,
    TraceWaypoint,
} from "./TraceGraphQuery";
import {
    TraceCoverageRecord,
    TraceEdge,
    TraceFact,
    TraceGate,
    TraceGraph,
    TraceStage,
} from "./TraceGraph";

export type TraceExplainStatus =
    | "explained"
    | "no-issue"
    | "needs-more-gate-evidence"
    | "source-unavailable";

export type TraceExplainConfidence = "certain" | "likely" | "unknown";

export type TraceCauseKind =
    | "ordinary.assignment_not_emitted"
    | "ordinary.field_store_not_emitted"
    | "ordinary.object_literal_property_not_emitted"
    | "ordinary.return_object_field_not_emitted"
    | "ordinary.template_string_not_emitted"
    | "ordinary.object_assign_not_emitted"
    | "ordinary.call_argument_not_emitted"
    | "ordinary.target_present_source_not_connected"
    | "ordinary.first_missing_waypoint_not_found"
    | "ordinary.overbroad_propagation"
    | "coverage.observed_surface_not_resolved"
    | "coverage.role_endpoint_guard_gap"
    | "semanticflow.llm_batch_not_run"
    | "semanticflow.llm_output_missing"
    | "rule.endpoint_or_guard_not_emitted"
    | "asset.validation_or_promotion_not_emitted"
    | "module.effect_or_lowering_not_emitted"
    | "arkmain.entry_or_seed_not_emitted"
    | "arkmain.source_seed_allowed_method_not_reached"
    | "semanticflow.asset_generation_or_promotion_not_emitted"
    | "OCLFS.currentness_not_live"
    | "UDE.deferred_edge_not_emitted"
    | "sink.overbroad_or_missing_sink_match"
    | "provenance.path_materialization_gap"
    | "reporting.report_emission_gap"
    | "postsolve.scoped_decision_gap"
    | "trace.missing_gate_coverage"
    | "trace.source_ambiguous"
    | "trace.illegal_propagation_edge"
    | "unknown";

export interface TraceExplanation {
    queryId: string;
    status: TraceExplainStatus;
    primaryLayer?: TraceStage;
    causeKind: TraceCauseKind;
    reason: string;
    confidence: TraceExplainConfidence;
    responsibleGate?: TraceGate;
    responsibleCoverage?: TraceCoverageRecord;
    responsibleEdge?: TraceEdge;
    evidence: string[];
    inspectedScope?: {
        method?: string;
        sourceFile?: string;
        sourceLine?: number;
        window?: string[];
    };
    repairHint?: string;
    missingGateCoverage?: boolean;
}

export interface TraceExplainOptions {
    projectRoot?: string;
    sourceRoot?: string;
    maxSourceWindowLines?: number;
}

interface SourceInspection {
    causeKind: TraceCauseKind;
    reason: string;
    confidence: TraceExplainConfidence;
    evidence: string[];
    inspectedScope?: TraceExplanation["inspectedScope"];
    status?: TraceExplainStatus;
}

export function explainTraceResult(
    graph: TraceGraph,
    query: FlowQuery,
    result: FlowQueryResult,
    options: TraceExplainOptions = {},
): TraceExplanation {
    if (query.kind === "should-report" && result.verdict === "reached") {
        return {
            queryId: query.id,
            status: "no-issue",
            primaryLayer: result.primaryLayer,
            causeKind: "unknown",
            reason: "The queried source, expected waypoints, and sink are all present in the current Trace Graph.",
            confidence: "certain",
            evidence: result.evidenceChain,
        };
    }

    if (query.kind === "should-not-report" && result.verdict === "reached") {
        return {
            queryId: query.id,
            status: "no-issue",
            primaryLayer: result.primaryLayer,
            causeKind: "unknown",
            reason: "The forbidden waypoint or sink is absent from the current Trace Graph.",
            confidence: "certain",
            evidence: result.evidenceChain,
        };
    }

    if (result.verdict === "illegal-propagation") {
        return explainIllegalPropagation(query, result);
    }

    if (result.verdict === "source-ambiguous") {
        return {
            queryId: query.id,
            status: "source-unavailable",
            causeKind: "trace.source_ambiguous",
            reason: `The source waypoint matches ${result.sourceMatchCount ?? "multiple"} TraceFacts. The query must identify a unique source by id, pagNode, method, stmt, value, fieldPath, or another exact anchor before downstream responsibility can be assigned.`,
            confidence: "certain",
            evidence: result.evidenceChain,
            repairHint: "Refine the Flow Query source anchor. Do not repair UDE, OCLFS, SemanticFlow, ordinary propagation, postsolve, or assets from an ambiguous source query.",
            missingGateCoverage: false,
        };
    }

    const responsibleGate = selectResponsibleGate(result.nearbyGates);
    const responsibleCoverage = selectResponsibleCoverage(result.nearbyCoverage, query, result);
    if (responsibleCoverage) {
        return {
            queryId: query.id,
            status: "explained",
            primaryLayer: responsibleCoverage.stage,
            causeKind: causeFromCoverage(responsibleCoverage),
            reason: reasonFromCoverage(responsibleCoverage),
            confidence: "certain",
            responsibleCoverage,
            evidence: [
                ...result.evidenceChain,
                `coverage ${responsibleCoverage.id} ${responsibleCoverage.kind}/${responsibleCoverage.stage} status=${responsibleCoverage.status}`,
            ],
            repairHint: repairHintForCoverage(responsibleCoverage),
            missingGateCoverage: false,
        };
    }

    if (responsibleGate) {
        return {
            queryId: query.id,
            status: "explained",
            primaryLayer: responsibleGate.stage,
            causeKind: causeFromStage(responsibleGate.stage),
            reason: responsibleGate.blockedReason || responsibleGate.skippedReason || "The responsible gate did not emit the expected propagation.",
            confidence: "certain",
            responsibleGate,
            evidence: [
                ...result.evidenceChain,
                `gate ${responsibleGate.id} ${responsibleGate.stage}/${responsibleGate.producer} emitted=${responsibleGate.emitted}`,
            ],
            repairHint: repairHintForStage(responsibleGate.stage),
        };
    }

    const sourceInspection = inspectLocalSource(graph, query, result, options);
    if (sourceInspection) {
        return {
            queryId: query.id,
            status: sourceInspection.status || "explained",
            primaryLayer: result.primaryLayer || "ordinary",
            causeKind: sourceInspection.causeKind,
            reason: sourceInspection.reason,
            confidence: sourceInspection.confidence,
            evidence: [...result.evidenceChain, ...sourceInspection.evidence],
            inspectedScope: sourceInspection.inspectedScope,
            repairHint: repairHintForCause(sourceInspection.causeKind),
            missingGateCoverage: sourceInspection.causeKind === "trace.missing_gate_coverage",
        };
    }

    return {
        queryId: query.id,
        status: "needs-more-gate-evidence",
        primaryLayer: result.primaryLayer,
        causeKind: "trace.missing_gate_coverage",
        reason: "The graph identifies the missing waypoint, but no responsible gate, edge, or inspectable source-local pattern explains why it was not emitted.",
        confidence: "unknown",
        evidence: result.evidenceChain,
        repairHint: "Instrument the layer that owns the missing waypoint so the next FullTraceRun records a TraceGate with attempted/matched/emitted and skip/block reason.",
        missingGateCoverage: true,
    };
}

export function explainTraceResults(
    graph: TraceGraph,
    queries: FlowQuery[],
    results: FlowQueryResult[],
    options: TraceExplainOptions = {},
): FlowQueryResult[] {
    return results.map((result, index) => ({
        ...result,
        explanation: explainTraceResult(graph, queries[index], result, options),
    }));
}

function explainIllegalPropagation(query: FlowQuery, result: FlowQueryResult): TraceExplanation {
    const edge = result.responsibleEdge || result.firstIllegalPropagation;
    const layer = edge?.stage || result.primaryLayer;
    return {
        queryId: query.id,
        status: "explained",
        primaryLayer: layer,
        causeKind: edge ? causeForIllegalEdge(edge) : "trace.illegal_propagation_edge",
        reason: edge
            ? `The forbidden waypoint is reached through emitted edge ${edge.id}: ${edge.reason}.`
            : "The forbidden waypoint is present, but the graph lacks an emitted responsible edge.",
        confidence: edge ? "certain" : "unknown",
        responsibleEdge: edge,
        evidence: [
            ...result.evidenceChain,
            result.whyNotAllowed ? `why-not-allowed: ${result.whyNotAllowed}` : "",
        ].filter(Boolean),
        repairHint: edge
            ? repairHintForStage(edge.stage)
            : "Instrument incoming propagation for the forbidden fact so the responsible edge is explicit.",
        missingGateCoverage: !edge,
    };
}

function selectResponsibleGate(gates: TraceGate[]): TraceGate | undefined {
    return gates.find(gate => !gate.emitted && (gate.blockedReason || gate.skippedReason))
        || gates.find(gate => !gate.emitted);
}

function selectResponsibleCoverage(
    records: TraceCoverageRecord[] = [],
    query?: FlowQuery,
    result?: FlowQueryResult,
): TraceCoverageRecord | undefined {
    const negativeRecords = records.filter(record =>
        record.status === "gap"
        || record.status === "blocked"
        || record.status === "failed"
        || record.status === "skipped",
    );
    const zeroHitSourceSeed = negativeRecords.find(record => isSourceRuleZeroHitCoverage(record));
    if (zeroHitSourceSeed) return zeroHitSourceSeed;
    const firstMissingIsSink = Boolean(query?.sink && result?.firstMissing && sameWaypoint(query.sink, result.firstMissing));
    const preferredKinds = firstMissingIsSink
        ? [
            "sink_candidate",
            "coverage_query",
            "semanticflow_candidate",
            "llm_batch",
            "llm_output",
            "asset_validation",
            "asset_promotion",
            "asset_lowering",
            "source_seed",
            "entry_recovery",
        ]
        : [
            "coverage_query",
            "semanticflow_candidate",
            "llm_batch",
            "llm_output",
            "asset_validation",
            "asset_promotion",
            "asset_lowering",
            "source_seed",
            "entry_recovery",
            "sink_candidate",
        ];
    for (const kind of preferredKinds) {
        const match = negativeRecords.find(record => record.kind === kind);
        if (match) return match;
    }
    return negativeRecords[0] || records.find(record => record.status === "queued");
}

function isSourceRuleZeroHitCoverage(record: TraceCoverageRecord): boolean {
    return record.kind === "source_seed"
        && record.reason === "source_rule_zero_hit";
}

function sameWaypoint(a: TraceWaypoint, b: TraceWaypoint): boolean {
    return a.id === b.id
        && a.labelContains === b.labelContains
        && a.methodContains === b.methodContains
        && a.stmtContains === b.stmtContains
        && a.valueContains === b.valueContains
        && a.fieldPathContains === b.fieldPathContains
        && a.pagNode === b.pagNode;
}

function inspectLocalSource(
    graph: TraceGraph,
    query: FlowQuery,
    result: FlowQueryResult,
    options: TraceExplainOptions,
): SourceInspection | undefined {
    if (result.verdict !== "missing" || !result.firstMissing) return undefined;
    const lastReached = result.lastReached;
    if (!lastReached?.method) return undefined;
    const source = resolveSourceFile(lastReached.method, options);
    if (!source) {
        return {
            causeKind: "trace.missing_gate_coverage",
            reason: "The graph has a lastReached method, but the corresponding source file could not be resolved for source-local explanation.",
            confidence: "unknown",
            status: "source-unavailable",
            evidence: [`method=${lastReached.method}`],
            inspectedScope: { method: lastReached.method },
        };
    }

    const lines = fs.readFileSync(source.filePath, "utf-8").split(/\r?\n/);
    const targetTokens = tokensFromWaypoint(result.firstMissing);
    const sourceTokens = tokensFromFact(lastReached);
    const methodWindow = extractMethodWindow(lines, source.methodName, options.maxSourceWindowLines || 120);
    const targetHits = findTokenHits(methodWindow.lines, targetTokens);
    const sourceHits = findTokenHits(methodWindow.lines, sourceTokens);
    const inspectedScope = {
        method: lastReached.method,
        sourceFile: source.filePath,
        sourceLine: targetHits[0] ? methodWindow.startLine + targetHits[0].index : methodWindow.startLine,
        window: compactWindow(methodWindow.lines, targetHits, sourceHits, options.maxSourceWindowLines || 120),
    };

    if (targetHits.length === 0) {
        return {
            causeKind: "ordinary.first_missing_waypoint_not_found",
            reason: `The expected waypoint token ${formatTokens(targetTokens)} is absent from the resolved source scope, so the query anchor does not correspond to an inspectable statement in this method.`,
            confidence: "likely",
            evidence: [
                `sourceFile=${source.filePath}`,
                `sourceTokens=${formatTokens(sourceTokens)}`,
                `targetTokens=${formatTokens(targetTokens)}`,
            ],
            inspectedScope,
        };
    }

    if (sourceHits.length === 0) {
        return {
            causeKind: "ordinary.target_present_source_not_connected",
            reason: `The target token ${formatTokens(targetTokens)} is present, but the lastReached value ${formatTokens(sourceTokens)} is not present in the same source scope.`,
            confidence: "likely",
            evidence: [
                `sourceFile=${source.filePath}`,
                `targetLine=${methodWindow.startLine + targetHits[0].index}`,
            ],
            inspectedScope,
        };
    }

    const between = sliceBetween(methodWindow.lines, sourceHits[0].index, targetHits[0].index).join("\n");
    const targetLine = targetHits[0].line;
    const text = `${between}\n${targetLine}`;
    const causeKind = classifySourcePattern(text, targetLine, targetTokens);
    return {
        causeKind,
        reason: reasonForSourcePattern(causeKind, sourceTokens, targetTokens),
        confidence: "likely",
        evidence: [
            `sourceFile=${source.filePath}`,
            `sourceLine=${methodWindow.startLine + targetHits[0].index}`,
            `sourceTokens=${formatTokens(sourceTokens)}`,
            `targetTokens=${formatTokens(targetTokens)}`,
        ],
        inspectedScope,
    };
}

function tokensFromWaypoint(waypoint: TraceWaypoint): string[] {
    return [
        waypoint.id,
        waypoint.labelContains,
        waypoint.methodContains,
        waypoint.stmtContains,
        waypoint.valueContains,
        waypoint.fieldPathContains,
    ].filter((item): item is string => Boolean(item && item.trim()))
        .flatMap(tokenize);
}

function tokensFromFact(fact: TraceFact): string[] {
    const valueTokens = [
        fact.value,
        ...(fact.fieldPath || []),
    ].filter((item): item is string => Boolean(item && item.trim()))
        .flatMap(tokenize)
        .filter(token => token.length > 1 && !token.startsWith("%"));
    if (valueTokens.length > 0) return [...new Set(valueTokens)];
    return [fact.stmt]
        .filter((item): item is string => Boolean(item && item.trim()))
        .flatMap(tokenize)
        .filter(token => token.length > 1 && !token.startsWith("%"));
}

function tokenize(value: string): string[] {
    const raw = String(value)
        .replace(/["'`]/g, " ")
        .split(/[^A-Za-z0-9_.$@/-]+/g)
        .map(item => item.trim())
        .filter(Boolean);
    const out: string[] = [];
    for (const item of raw) {
        out.push(item);
        const dotted = item.split(".");
        if (dotted.length > 1) out.push(...dotted);
        const slashed = item.split(/[\\/]/);
        if (slashed.length > 1) out.push(...slashed);
    }
    return [...new Set(out.filter(item => item.length > 1))];
}

function findTokenHits(lines: string[], tokens: string[]): Array<{ index: number; line: string; token: string }> {
    const hits: Array<{ index: number; line: string; token: string }> = [];
    const uniqueTokens = [...new Set(tokens)];
    lines.forEach((line, index) => {
        for (const token of uniqueTokens) {
            if (line.includes(token)) {
                hits.push({ index, line, token });
                break;
            }
        }
    });
    return hits;
}

function classifySourcePattern(text: string, targetLine: string, targetTokens: string[]): TraceCauseKind {
    const lower = text.toLowerCase();
    const hasReturn = /\breturn\b/.test(lower);
    const hasObjectLiteralField = targetTokens.some(token => new RegExp(`["']?${escapeRegex(token)}["']?\\s*:`).test(targetLine));
    if (hasReturn && hasObjectLiteralField) return "ordinary.return_object_field_not_emitted";
    if (hasObjectLiteralField) return "ordinary.object_literal_property_not_emitted";
    if (lower.includes("object.assign")) return "ordinary.object_assign_not_emitted";
    if (targetLine.includes("`") || targetLine.includes("${")) return "ordinary.template_string_not_emitted";
    if (targetLine.includes("=") && targetLine.includes(".")) return "ordinary.field_store_not_emitted";
    if (targetLine.includes("=")) return "ordinary.assignment_not_emitted";
    if (targetLine.includes("(") && targetLine.includes(")")) return "ordinary.call_argument_not_emitted";
    return "ordinary.assignment_not_emitted";
}

function reasonForSourcePattern(kind: TraceCauseKind, sourceTokens: string[], targetTokens: string[]): string {
    const source = formatTokens(sourceTokens);
    const target = formatTokens(targetTokens);
    switch (kind) {
        case "ordinary.return_object_field_not_emitted":
            return `The source-local code returns an object field ${target} derived from ${source}, but the Trace Graph has no emitted ordinary edge from the reached value to that returned field.`;
        case "ordinary.object_literal_property_not_emitted":
            return `The source-local code builds object literal property ${target} from ${source}, but the Trace Graph has no emitted ordinary edge to that property.`;
        case "ordinary.template_string_not_emitted":
            return `The source-local code embeds ${source} into template-derived value ${target}, but the Trace Graph has no emitted ordinary edge through the template expression.`;
        case "ordinary.object_assign_not_emitted":
            return `The source-local code transfers ${source} through Object.assign toward ${target}, but the Trace Graph has no emitted ordinary edge for that object-copy step.`;
        case "ordinary.field_store_not_emitted":
            return `The source-local code stores ${source} into field ${target}, but the Trace Graph has no emitted ordinary field-store edge.`;
        case "ordinary.call_argument_not_emitted":
            return `The source-local code passes ${source} into a call involving ${target}, but the Trace Graph has no emitted ordinary call-argument edge.`;
        default:
            return `The source-local code connects ${source} to ${target}, but the Trace Graph has no emitted ordinary propagation edge for that step.`;
    }
}

function repairHintForCause(kind: TraceCauseKind): string {
    if (kind.startsWith("ordinary.")) {
        return "Repair ordinary language propagation for this syntactic pattern with positive and adjacent negative tests; do not add project API rules.";
    }
    if (kind.startsWith("module.")) return repairHintForStage("module");
    if (kind.startsWith("rule.")) return repairHintForStage("source_seed");
    if (kind.startsWith("semanticflow.")) {
        return "Repair SemanticFlow evidence, asset generation, validation, or promotion using declarative v2 assets and bounded LLM gates.";
    }
    if (kind === "trace.source_ambiguous") {
        return "Refine the Flow Query source anchor until it matches exactly one TraceFact.";
    }
    if (kind.startsWith("OCLFS.")) return repairHintForStage("OCLFS");
    return "Repair the owning stage that failed to record or emit the necessary graph evidence.";
}

function causeFromStage(stage: TraceStage): TraceCauseKind {
    switch (stage) {
        case "preanalysis":
        case "coverage_ledger":
            return "semanticflow.asset_generation_or_promotion_not_emitted";
        case "semanticflow":
        case "semanticflow_llm":
            return "semanticflow.asset_generation_or_promotion_not_emitted";
        case "asset_validation":
        case "asset_promotion":
            return "asset.validation_or_promotion_not_emitted";
        case "asset_lowering":
        case "module_lowering":
            return "module.effect_or_lowering_not_emitted";
        case "entry_recovery":
            return "arkmain.entry_or_seed_not_emitted";
        case "source_seed":
            return "arkmain.entry_or_seed_not_emitted";
        case "rule":
            return "rule.endpoint_or_guard_not_emitted";
        case "ordinary":
            return "ordinary.assignment_not_emitted";
        case "module":
            return "module.effect_or_lowering_not_emitted";
        case "OCLFS":
            return "OCLFS.currentness_not_live";
        case "UDE":
            return "UDE.deferred_edge_not_emitted";
        case "sink_candidate":
        case "sink":
            return "sink.overbroad_or_missing_sink_match";
        case "provenance":
            return "provenance.path_materialization_gap";
        case "reporting":
            return "reporting.report_emission_gap";
        case "postsolve":
            return "postsolve.scoped_decision_gap";
        default:
            return "unknown";
    }
}

function causeFromCoverage(record: TraceCoverageRecord): TraceCauseKind {
    if (record.kind === "observed_surface" && record.status !== "emitted" && record.status !== "covered") {
        return "coverage.observed_surface_not_resolved";
    }
    if (record.kind === "coverage_query" && (record.status === "gap" || record.status === "skipped")) {
        return "coverage.role_endpoint_guard_gap";
    }
    if (record.kind === "llm_batch" && record.status !== "emitted" && record.status !== "queued") {
        return "semanticflow.llm_batch_not_run";
    }
    if (record.kind === "llm_output" && record.status !== "emitted") {
        return "semanticflow.llm_output_missing";
    }
    if (
        record.kind === "source_seed"
        && record.reason === "source_rule_zero_hit"
        && (record.evidence as any)?.zeroHitReason === "source_rule_callsite_outside_allowed_methods"
    ) {
        return "arkmain.source_seed_allowed_method_not_reached";
    }
    return causeFromStage(record.stage);
}

function reasonFromCoverage(record: TraceCoverageRecord): string {
    const subject = record.subject || record.label || record.assetId || record.surfaceId || record.id;
    if (record.kind === "source_seed" && record.reason === "source_rule_zero_hit") {
        const evidence: any = record.evidence || {};
        const detail = evidence.zeroHitReason
            ? ` zeroHitReason=${evidence.zeroHitReason}; matchedCallsites=${evidence.matchedCallsiteCount ?? "unknown"}; matchedAllowed=${evidence.matchedAllowedCallsiteCount ?? "unknown"}; matchedExcluded=${evidence.matchedExcludedCallsiteCount ?? "unknown"}.`
            : "";
        return `Source rule ${subject} produced no seed under current analysis scope.${detail}`;
    }
    if (record.reason) {
        return `Semantic coverage record ${record.id} for ${subject} is ${record.status}: ${record.reason}.`;
    }
    switch (record.kind) {
        case "observed_surface":
            return `The observed surface ${subject} is present in the coverage graph, but it did not reach a usable covered state.`;
        case "coverage_query":
            return `Coverage query for ${subject} did not prove identity + role + endpoint + guard coverage under current assets.`;
        case "semanticflow_candidate":
            return `SemanticFlow candidate ${subject} did not emit a usable declarative asset under the current evidence.`;
        case "llm_batch":
            return `LLM modeling batch for ${subject} was not completed as a coverage-proven modeling step.`;
        case "llm_output":
            return `LLM output for ${subject} did not produce a usable declarative v2 asset.`;
        case "asset_validation":
            return `Asset validation for ${subject} did not produce a schema-valid/analyzer-backed asset.`;
        case "asset_promotion":
            return `Asset promotion for ${subject} did not make the asset available to the current analysis.`;
        case "asset_lowering":
            return `Asset lowering for ${subject} did not emit the effect/state representation consumed by analysis.`;
        case "entry_recovery":
            return `Entry recovery for ${subject} did not emit the entry or activation needed by the analysis.`;
        case "source_seed":
            return `Source seeding for ${subject} did not emit an initial label under current assets.`;
        case "sink_candidate":
            return `Sink candidate ${subject} did not emit a sink match under current assets.`;
    }
}

function repairHintForCoverage(record: TraceCoverageRecord): string {
    if (record.kind === "source_seed" && record.reason === "source_rule_zero_hit") {
        const zeroHitReason = (record.evidence as any)?.zeroHitReason;
        if (zeroHitReason === "source_rule_callsite_outside_allowed_methods") {
            return "Repair entry recovery or reachable-method activation so the matching source-rule callsite enters the source-seed allowed method set; do not broaden the source selector.";
        }
        if (zeroHitReason === "source_rule_matching_callsite_no_seed_fact") {
            return "Repair source seed target-node extraction for the matched callsite; keep the source selector unchanged.";
        }
        if (zeroHitReason === "source_rule_no_matching_callsite") {
            return "Repair the asset selector or analyzer-backed surface identity; no callsite matched this source rule in the scene.";
        }
    }
    if (record.kind === "coverage_query") {
        return "Use the coverage graph to decide the next step: covered records stay in current-assets trace; gap records may enter bounded SemanticFlow/LLM modeling in batches, then validated assets must return to a new same-Scene trace.";
    }
    if (record.kind === "llm_batch" || record.kind === "llm_output" || record.kind === "semanticflow_candidate") {
        return "Repair the SemanticFlow/LLM modeling package for this bounded coverage-proven gap; keep output declarative v2 and validate before re-tracing.";
    }
    if (record.kind === "asset_validation" || record.kind === "asset_promotion" || record.kind === "asset_lowering") {
        return "Repair the asset validation/promotion/lowering gate that prevents a validated model from becoming analysis facts; do not add direct propagation.";
    }
    if (record.kind === "source_seed") {
        return "Repair source seeding under current assets or prove the missing source is a coverage gap before invoking SemanticFlow/LLM.";
    }
    if (record.kind === "sink_candidate") {
        return "Repair sink candidate coverage and endpoint selection under current assets; do not broaden sink matching by name.";
    }
    return repairHintForStage(record.stage);
}

function causeForIllegalEdge(edge: TraceEdge): TraceCauseKind {
    if (edge.stage === "ordinary") return "ordinary.overbroad_propagation";
    if (edge.stage === "sink") return "sink.overbroad_or_missing_sink_match";
    if (edge.stage === "postsolve") return "postsolve.scoped_decision_gap";
    return causeFromStage(edge.stage);
}

function repairHintForStage(stage?: TraceStage): string {
    switch (stage) {
        case "preanalysis":
            return "Repair observed-surface or coverage-ledger evidence; do not make SemanticFlow guess raw project APIs without analyzer anchors.";
        case "coverage_ledger":
            return "Repair coverage-ledger identity + role + endpoint + guard accounting; if it proves a gap, send only that bounded gap to SemanticFlow/LLM.";
        case "semanticflow":
            return "Repair SemanticFlow evidence packaging, bounded LLM asset generation, or candidate selection; outputs must remain declarative v2 assets.";
        case "semanticflow_llm":
            return "Repair bounded LLM modeling batches and repair prompts for coverage-proven gaps; do not bundle LLM debugging with full analysis.";
        case "asset_validation":
            return "Repair asset schema/analyzer-backed validation with exact identity, role, endpoint, guard, and cellKind evidence.";
        case "asset_promotion":
            return "Repair promotion gate status/evidence; candidate assets must not become trusted coverage without reviewed/replayed validation.";
        case "asset_lowering":
            return "Repair declarative asset lowering from validated assets to effect/state representations; do not add direct propagation.";
        case "entry_recovery":
            return "Repair entry recovery or ArkMain assets with analyzer-backed entry evidence.";
        case "source_seed":
            return "Repair entry/source seeding or official/source asset matching; do not widen sources by name.";
        case "rule":
            return "Repair rule asset endpoint/guard/role matching with positive and negative tests; do not use broad API-name matching.";
        case "ordinary":
            return "Repair ordinary propagation with focused positive and negative tests for the missing syntax shape.";
        case "module_lowering":
            return "Repair declarative asset lowering or module effect emission; project APIs stay in project assets and LLM modeling.";
        case "module":
            return "Repair module asset lowering or effect emission; third-party/project APIs must stay declarative assets.";
        case "OCLFS":
            return "Repair StateEffect/currentness evidence; do not move path-sensitive filtering into OCLFS.";
        case "UDE":
            return "Repair deferred execution edge recovery using UDE evidence; do not infer callback order from source order alone.";
        case "sink_candidate":
            return "Repair sink candidate coverage/selector evidence before changing sink emission; do not broaden sink matching.";
        case "sink":
            return "Repair sink selector/report scope with endpoint-sensitive tests; do not add broad contains matching.";
        case "provenance":
            return "Repair path materialization evidence and gaps; do not add propagation in provenance.";
        case "reporting":
            return "Repair report emission or deduplication scope; do not change propagation or postsolve semantics from reporting.";
        case "postsolve":
            return "Repair scoped postsolve evidence; do not recover missing propagation in postsolve.";
        default:
            return "Repair the graph-proven primary layer and add missing TraceGate evidence if the layer is ambiguous.";
    }
}

function resolveSourceFile(method: string, options: TraceExplainOptions): { filePath: string; methodName?: string } | undefined {
    const parsed = parseMethodSource(method);
    const roots = [options.sourceRoot, options.projectRoot].filter((item): item is string => Boolean(item));
    const candidates: string[] = [];
    if (parsed.fileLike) {
        if (path.isAbsolute(parsed.fileLike)) candidates.push(parsed.fileLike);
        for (const root of roots) {
            candidates.push(path.join(root, parsed.fileLike));
            candidates.push(path.join(root, parsed.fileLike.replace(/^ets[\\/]/, "")));
            candidates.push(path.join(root, parsed.fileLike.replace(/^entry[\\/]src[\\/]main[\\/]ets[\\/]/, "")));
        }
    }
    for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return { filePath: candidate, methodName: parsed.methodName };
        }
    }
    if (parsed.fileLike) {
        for (const root of roots) {
            const found = findBySuffix(root, parsed.fileLike);
            if (found) return { filePath: found, methodName: parsed.methodName };
        }
    }
    return undefined;
}

function parseMethodSource(method: string): { fileLike?: string; methodName?: string } {
    const atMatch = method.match(/@([^:]+):\s*(.+)$/);
    const fileLike = normalizeSourceLike(atMatch?.[1] || method.match(/([A-Za-z0-9_./\\-]+\.(?:ets|ts))/)?.[1]);
    const ownerMethod = (atMatch?.[2] || method).match(/([A-Za-z_$][\w$]*)\s*\(/);
    const dottedMethod = (atMatch?.[2] || method).match(/\.([A-Za-z_$][\w$]*)\s*\(/);
    return {
        fileLike,
        methodName: dottedMethod?.[1] || ownerMethod?.[1],
    };
}

function normalizeSourceLike(value?: string): string | undefined {
    if (!value) return undefined;
    return value.replace(/^@/, "").replace(/\\/g, path.sep).replace(/\//g, path.sep);
}

function findBySuffix(root: string, suffix: string): string | undefined {
    if (!fs.existsSync(root)) return undefined;
    const normalizedSuffix = suffix.replace(/\\/g, "/").replace(/^.*?entry\/src\/main\/ets\//, "").replace(/^ets\//, "");
    const stack = [root];
    let visited = 0;
    while (stack.length > 0 && visited < 20000) {
        const current = stack.pop()!;
        visited++;
        let stat: fs.Stats;
        try {
            stat = fs.statSync(current);
        } catch {
            continue;
        }
        if (stat.isDirectory()) {
            for (const child of fs.readdirSync(current)) {
                if (child === "node_modules" || child === ".git" || child === "oh_modules") continue;
                stack.push(path.join(current, child));
            }
            continue;
        }
        if (!stat.isFile()) continue;
        const normalized = current.replace(/\\/g, "/");
        if (normalized.endsWith(normalizedSuffix) || normalized.endsWith(suffix.replace(/\\/g, "/"))) {
            return current;
        }
    }
    return undefined;
}

function extractMethodWindow(lines: string[], methodName: string | undefined, maxLines: number): { startLine: number; lines: string[] } {
    if (!methodName) {
        return { startLine: 1, lines: lines.slice(0, maxLines) };
    }
    const declaration = new RegExp(`(^|\\s)(?:public\\s+|private\\s+|protected\\s+|static\\s+|async\\s+)*${escapeRegex(methodName)}\\s*\\(`);
    let methodIndex = lines.findIndex(line => declaration.test(line) && !line.includes(`.${methodName}(`));
    if (methodIndex < 0) {
        methodIndex = lines.findIndex(line => line.includes(methodName));
    }
    if (methodIndex < 0) {
        return { startLine: 1, lines: lines.slice(0, maxLines) };
    }
    let depth = 0;
    let seenBrace = false;
    const out: string[] = [];
    for (let i = methodIndex; i < lines.length && out.length < maxLines; i++) {
        const line = lines[i];
        out.push(line);
        for (const ch of line) {
            if (ch === "{") {
                seenBrace = true;
                depth++;
            } else if (ch === "}") {
                depth--;
            }
        }
        if (seenBrace && depth <= 0) break;
    }
    return { startLine: methodIndex + 1, lines: out };
}

function compactWindow(
    lines: string[],
    targetHits: Array<{ index: number }>,
    sourceHits: Array<{ index: number }>,
    maxLines: number,
): string[] {
    const indexes = [...targetHits, ...sourceHits].map(item => item.index);
    if (indexes.length === 0 || lines.length <= maxLines) return lines;
    const min = Math.max(0, Math.min(...indexes) - 8);
    const max = Math.min(lines.length, Math.max(...indexes) + 9);
    return lines.slice(min, max);
}

function sliceBetween(lines: string[], a: number, b: number): string[] {
    const start = Math.max(0, Math.min(a, b) - 2);
    const end = Math.min(lines.length, Math.max(a, b) + 3);
    return lines.slice(start, end);
}

function formatTokens(tokens: string[]): string {
    return [...new Set(tokens)].slice(0, 6).join(", ") || "<none>";
}

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
