import * as fs from "fs";
import * as path from "path";
import {
    ensureAnalyzeOutputLayout,
    resolveAnalyzeOutputLayout,
    writeAnalyzeRunManifest,
} from "../../cli/analyzeOutputLayout";
import { writeC6DiagnosticArtifacts } from "../../cli/c6Diagnostics";
import { generateExpectedFlowGapReport, parseExpectedFlowLedger } from "../../cli/expectedFlowGapReport";
import { buildTraceGraph } from "../../core/trace/TraceGraph";
import { resolveTestRunDir } from "../helpers/TestWorkspaceLayout";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function readJson(filePath: string): any {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function readJsonl(filePath: string): any[] {
    const text = fs.readFileSync(filePath, "utf-8").trim();
    return text ? text.split(/\r?\n/).map(line => JSON.parse(line)) : [];
}

function writeJson(filePath: string, value: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
}

function main(): void {
    const runDir = resolveTestRunDir("analyze", "c6_expected_flow_gap_report");
    fs.rmSync(runDir, { recursive: true, force: true });
    const layout = resolveAnalyzeOutputLayout(runDir);
    ensureAnalyzeOutputLayout(layout);

    const entry: any = {
        sourceDir: ".",
        entryName: "entry",
        officialOccurrenceLedger: [{
            occurrenceId: "occ:http:request:1",
            rawOccurrenceId: "raw:http:request:1",
            sourceFile: "entry/src/main/ets/Demo.ets",
            sourceLocation: { line: 10, column: 5 },
            enclosingMethodSignature: "Demo.main()",
            statementText: "http.request(url)",
            syntaxKind: "call",
            status: "accepted",
            canonicalApiId: "official:@ohos.net.http/HttpRequest.request",
            reasonCode: "accepted_exact_import",
            candidates: [],
            officialBasis: ["resolved_official_descriptor"],
            descriptor: {
                authority: "official",
                domain: "network",
                moduleSpecifier: "@ohos.net.http",
                logicalDeclarationFile: "api/@ohos.net.http.d.ts",
                ownerKind: "class",
                ownerPath: ["HttpRequest"],
                memberKind: "method",
                memberName: "request",
                invokeKind: "call",
            },
            evidence: {},
            evidenceGraph: {},
        }],
        pagNodeResolutionAudit: {
            endpointResolutionRecords: [{
                effectSiteId: "site:http:request:1",
                occurrenceId: "occ:http:request:1",
                rawOccurrenceId: "raw:http:request:1",
                canonicalApiId: "official:@ohos.net.http/HttpRequest.request",
                capability: "sink",
                effectAssetId: "asset:http.request.url",
                endpointPath: "arg0",
                endpointBaseKind: "arg",
                consumer: "sink",
                valueKind: "arg",
                status: "resolved",
                reason: "resolved_exact_arg",
                nodeIds: [2],
                carrierNodeIds: [],
                materializedExact: true,
                substitutionKind: "exact_pag_value",
            }],
        },
        semanticEffectLedger: [{
            recordKind: "semantic_effect_site",
            status: "resolved",
            reasonCode: "endpoint_resolved",
            effectSiteId: "site:http:request:1",
            occurrenceId: "occ:http:request:1",
            rawOccurrenceId: "raw:http:request:1",
            canonicalApiId: "official:@ohos.net.http/HttpRequest.request",
            capability: "sink",
            effectAssetId: "asset:http.request.url",
            surfaceId: "surface:http.request",
            bindingId: "binding:http.request.url",
            effectTemplateId: "template:http.request.url",
            endpointBindingRef: "value",
            endpointSpec: { base: { kind: "arg", index: 0 } },
            endpointResolution: {
                effectSiteId: "site:http:request:1",
                occurrenceId: "occ:http:request:1",
                rawOccurrenceId: "raw:http:request:1",
                canonicalApiId: "official:@ohos.net.http/HttpRequest.request",
                capability: "sink",
                effectAssetId: "asset:http.request.url",
                endpointPath: "arg0",
                endpointBaseKind: "arg",
                consumer: "sink",
                valueKind: "arg",
                status: "resolved",
                reason: "resolved_exact_arg",
                nodeIds: [2],
                carrierNodeIds: [],
                materializedExact: true,
                substitutionKind: "exact_pag_value",
            },
        }, {
            recordKind: "semantic_effect_site",
            status: "resolved",
            reasonCode: "endpoint_resolved",
            effectSiteId: "site:transfer:bridge:1",
            occurrenceId: "occ:transfer:bridge:1",
            rawOccurrenceId: "raw:transfer:bridge:1",
            canonicalApiId: "official:@demo/Bridge.forward",
            capability: "transfer",
            effectAssetId: "asset:transfer.bridge",
            surfaceId: "surface:transfer.bridge",
            bindingId: "binding:transfer.bridge",
            effectTemplateId: "template:transfer.bridge",
            endpointBindingRef: "from",
            endpointSpec: { base: { kind: "arg", index: 0 } },
            endpointResolution: {
                effectSiteId: "site:transfer:bridge:1",
                occurrenceId: "occ:transfer:bridge:1",
                rawOccurrenceId: "raw:transfer:bridge:1",
                canonicalApiId: "official:@demo/Bridge.forward",
                capability: "transfer",
                effectAssetId: "asset:transfer.bridge",
                endpointPath: "arg0",
                endpointBaseKind: "arg",
                consumer: "transfer",
                valueKind: "arg",
                status: "resolved",
                reason: "resolved_exact_arg",
                nodeIds: [7],
                carrierNodeIds: [],
                materializedExact: true,
                substitutionKind: "exact_pag_value",
            },
        }, {
            recordKind: "semantic_effect_site",
            status: "resolved",
            reasonCode: "endpoint_resolved",
            effectSiteId: "site:module:router:1",
            occurrenceId: "occ:module:router:1",
            rawOccurrenceId: "raw:module:router:1",
            canonicalApiId: "official:@ohos.router/pushUrl",
            capability: "module",
            effectAssetId: "asset:module.router",
            surfaceId: "surface:module.router",
            bindingId: "binding:module.router",
            effectTemplateId: "template:module.router",
            endpointBindingRef: "payload",
            endpointSpec: { base: { kind: "arg", index: 0 } },
            endpointResolution: {
                effectSiteId: "site:module:router:1",
                occurrenceId: "occ:module:router:1",
                rawOccurrenceId: "raw:module:router:1",
                canonicalApiId: "official:@ohos.router/pushUrl",
                capability: "module",
                effectAssetId: "asset:module.router",
                endpointPath: "arg0",
                endpointBaseKind: "arg",
                consumer: "module",
                valueKind: "arg",
                status: "resolved",
                reason: "resolved_exact_arg",
                nodeIds: [8],
                carrierNodeIds: [],
                materializedExact: true,
                substitutionKind: "exact_pag_value",
            },
        }, {
            recordKind: "semantic_effect_gap",
            status: "effect_gap",
            gapKind: "accepted_without_effect_asset",
            reasonCode: "no_effect_asset_binding_for_accepted_occurrence",
            occurrenceId: "occ:toast:missing-asset",
            rawOccurrenceId: "raw:toast:missing-asset",
            canonicalApiId: "official:@ohos.promptAction/showToast",
            anchor: {
                sourceFile: "entry/src/main/ets/Demo.ets",
                sourceLocation: { line: 20, column: 5 },
                enclosingMethodSignature: "Demo.main()",
                statementText: "promptAction.showToast({ message })",
            },
        }, {
            recordKind: "semantic_effect_gap",
            status: "effect_gap",
            gapKind: "effect_asset_without_accepted_occurrence",
            reasonCode: "effect_asset_without_accepted_occurrence",
            canonicalApiId: "official:@ohos.file.fs/write",
            capability: "sink",
            effectAssetId: "asset:fs.write",
            surfaceId: "surface:fs.write",
            bindingId: "binding:fs.write",
            effectTemplateId: "template:fs.write",
            endpointSpec: { base: { kind: "arg", index: 1 } },
            diagnosticDetails: { acceptedOccurrenceCount: 0 },
        }],
        sourceRuleZeroHitAudit: [{
            ruleId: "source.remote.response",
            sourceKind: "call_return",
            reason: "source_rule_callsite_outside_allowed_methods",
            allowedMethodFilterActive: true,
            matchedCallsiteCount: 1,
            matchedAllowedCallsiteCount: 0,
            matchedExcludedCallsiteCount: 1,
            sampleCallsites: [{
                methodSignature: "Demo.load()",
                calleeSignature: "Http.request()",
                stmtText: "response = http.request(url)",
                line: 12,
                allowed: false,
                effectSiteId: "site:http:response:1",
                occurrenceId: "occ:http:response:1",
                rawOccurrenceId: "raw:http:response:1",
                canonicalApiId: "official:@ohos.net.http/HttpRequest.request",
                effectAssetId: "asset:http.response",
                reachableGapChain: {
                    status: "blocked",
                    reason: "accepted_source_site_method_not_in_allowed_reachable_fixed_point",
                    targetMethodSignature: "Demo.load()",
                    targetAllowed: false,
                    sourceRuleCallsite: {
                        calleeSignature: "Http.request()",
                        stmtText: "response = http.request(url)",
                        line: 12,
                    },
                    evidence: ["accepted_api_effect_source_site"],
                },
            }],
        }],
        callEdgeMaterializationLedger: [{
            recordKind: "call_edge_materialization",
            builder: "synthetic_invoke",
            edgeKind: "arg_to_param",
            status: "not_built",
            reason: "missing_param_destination_nodes",
            callerSignature: "Demo.entry()",
            calleeSignature: "Demo.load()",
            callerMethodName: "entry",
            calleeMethodName: "load",
            line: 11,
            stmtText: "this.load(url)",
            argIndex: 0,
            paramIndex: 0,
            srcNodeIds: [1],
            dstNodeIds: [],
            builtEdgeCount: 0,
            syntheticEdgeBuilt: false,
            calleeResolveReason: "exact",
        }],
        sinkDetectionAudit: {
            entries: [{
                kind: "sanitized",
                ruleId: "sink.http.request",
                effectIdentity: "official:@ohos.net.http/HttpRequest.request",
                endpoint: "arg0",
                reason: "guard_applied",
                candidateNodeIds: [2],
            }],
            overflowCount: 0,
        },
        transferProfile: {
            factCount: 1,
            invokeSiteCount: 1,
            ruleCheckCount: 1,
            ruleMatchCount: 1,
            endpointCheckCount: 1,
            endpointMatchCount: 0,
            dedupSkipCount: 0,
            resultCount: 0,
            elapsedMs: 0,
            elapsedShare: 0,
            noCandidateCallsites: [],
        },
        transferNoHitReasons: ["from_endpoint_not_tainted_or_path_mismatch"],
        moduleAudit: {
            loadedModuleIds: ["module.demo"],
            failedModuleIds: [],
            failureEvents: [],
            moduleStats: {
                "module.demo": {
                    moduleId: "module.demo",
                    factHookCalls: 1,
                    invokeHookCalls: 0,
                    copyEdgeChecks: 0,
                    factHookMs: 0,
                    invokeHookMs: 0,
                    copyEdgeMs: 0,
                    factEmissionCount: 0,
                    invokeEmissionCount: 0,
                    totalEmissionCount: 0,
                    skipCopyEdgeCount: 0,
                    debugHitCount: 0,
                    debugSkipCount: 1,
                    debugLogCount: 1,
                    recentDebugMessages: ["no endpoint"],
                    emissionSamples: [],
                    emissionSampleOverflowCount: 0,
                },
            },
        },
    };
    entry.traceGraph = buildTraceGraph(
        {
            runId: "c6-diagnostic-fixture",
            project: "fixture",
            engineVersion: "test",
            assetVersion: "test",
            configHash: "test",
            startedAt: "2026-06-26T00:00:00.000Z",
            completedAt: "2026-06-26T00:00:01.000Z",
            status: "completed",
        },
        [{
            id: "f:secret",
            label: "source_rule:secret",
            pagNode: 10,
            context: 0,
            fieldPath: ["payload"],
            value: "record.payload",
            stmt: "target.payload = record.payload",
        }, {
            id: "f:items",
            label: "source_rule:secret",
            pagNode: 11,
            context: 0,
            fieldPath: ["items", "*"],
            value: "segments[0].url",
            stmt: "segments.map(segment => segment.url)",
        }, {
            id: "f:json",
            label: "source_rule:secret",
            pagNode: 12,
            context: 0,
            value: "JSON.parse(serialized).payload",
            stmt: "parsed = JSON.parse(serialized)",
        }, {
            id: "f:result",
            label: "source_rule:secret",
            pagNode: 13,
            context: 0,
            value: "resultSet.getString('token')",
            stmt: "token = resultSet.getString('token')",
        }],
        [],
        [{
            id: "g:field",
            fromFact: "f:secret",
            stage: "ordinary",
            producer: "ordinary",
            gateKind: "propagation",
            scope: "object-literal nested field load",
            attempted: true,
            matched: false,
            emitted: false,
            skippedReason: "missing_object_field_load",
        }, {
            id: "g:container",
            fromFact: "f:items",
            stage: "ordinary",
            producer: "ordinary",
            gateKind: "propagation",
            scope: "collection item slot propagation",
            attempted: true,
            matched: false,
            emitted: false,
            skippedReason: "missing_collection_slot",
        }, {
            id: "g:json",
            fromFact: "f:json",
            stage: "ordinary",
            producer: "ordinary",
            gateKind: "propagation",
            scope: "JSON parse serialized copy carrier",
            attempted: true,
            matched: false,
            emitted: false,
            skippedReason: "missing_json_parse_result",
        }, {
            id: "g:callback",
            fromFact: "f:items",
            stage: "ordinary",
            producer: "ordinary",
            gateKind: "propagation",
            scope: "callback mapper child task",
            attempted: true,
            matched: false,
            emitted: false,
            skippedReason: "missing_callback_mapper_value",
        }, {
            id: "g:parser",
            fromFact: "f:items",
            stage: "ordinary",
            producer: "ordinary",
            gateKind: "propagation",
            scope: "text parser split segment value",
            attempted: true,
            matched: false,
            emitted: false,
            skippedReason: "missing_parser_segment_value",
        }, {
            id: "g:result",
            fromFact: "f:result",
            stage: "ordinary",
            producer: "ordinary",
            gateKind: "propagation",
            scope: "ResultSet query scalar result container",
            attempted: true,
            matched: false,
            emitted: false,
            skippedReason: "missing_result_container_scalar",
        }],
    );
    const report: any = {
        generatedAt: "2026-06-26T00:00:00.000Z",
        repo: "fixture",
        profile: "fast",
        reportMode: "summary",
        summary: {
            statusCount: {},
            officialIdentityCoverage: {
                totalOccurrenceCount: 1,
                acceptedCount: 1,
                unresolvedCount: 0,
                ambiguousCount: 0,
                rejectedCount: 0,
                byStatus: { accepted: 1, unresolved: 0, ambiguous: 0, rejected: 0 },
                bySyntaxKind: { call: 1 },
                byReasonCode: { accepted_exact_import: 1 },
                bySourceFile: { "entry/src/main/ets/Demo.ets": 1 },
                byDomain: { network: 1 },
                byModuleSpecifier: { "@ohos.net.http": 1 },
                byResolutionKind: { exact: 1 },
                acceptedCanonicalApiIds: 1,
            },
        },
    };

    writeC6DiagnosticArtifacts(layout, [entry], report);
    writeAnalyzeRunManifest(layout, report, { pluginAuditEnabled: false, traceGraphEnabled: true });

    const manifest = readJson(layout.runJsonPath);
    assert(manifest.paths.semanticEffectSitesJsonl === "audit/semantic_effect_sites.jsonl", "run manifest should expose semantic_effect_sites.jsonl");
    assert(manifest.paths.expectedFlowGapReportJson === "audit/expected_flow_gap_report.json", "run manifest should expose expected flow report JSON");
    assert(manifest.paths.officialCoverageForLlmFilteringJson === "audit/official_coverage_for_llm_filtering.json", "run manifest should expose LLM coverage artifact");

    const semanticSites = readJsonl(layout.semanticEffectSitesJsonlPath);
    assert(semanticSites.length === 5, "semantic effect ledger should preserve site and gap rows");
    const resolvedSite = semanticSites.find(row => row.recordKind === "semantic_effect_site");
    assert(resolvedSite?.status === "resolved", "semantic effect site row should preserve endpoint resolution status");
    assert(resolvedSite.effectAssetId === "asset:http.request.url", "semantic effect site row should link to exact effect asset");
    assert(resolvedSite.endpointResolution?.status === "resolved", "semantic effect site row should include endpoint resolution");
    const acceptedGap = semanticSites.find(row => row.gapKind === "accepted_without_effect_asset");
    assert(acceptedGap?.reasonCode === "no_effect_asset_binding_for_accepted_occurrence", "accepted occurrence without asset should be durable");
    const assetGap = semanticSites.find(row => row.gapKind === "effect_asset_without_accepted_occurrence");
    assert(assetGap?.effectAssetId === "asset:fs.write", "asset without accepted occurrence should identify effect asset");

    const endpointSummary = readJson(layout.endpointResolutionSummaryJsonPath);
    assert(endpointSummary.byCapability.sink.resolved === 1, "endpoint summary should group by capability and status");
    assert(endpointSummary.semanticEffectLedgerSummary.siteRecordCount === 3, "endpoint summary should include semantic site count");
    assert(endpointSummary.semanticEffectLedgerSummary.byGapKind.accepted_without_effect_asset === 1, "semantic summary should count accepted asset gaps");
    assert(endpointSummary.semanticEffectLedgerSummary.byGapKind.effect_asset_without_accepted_occurrence === 1, "semantic summary should count asset occurrence gaps");
    const reachabilityRows = readJsonl(layout.sourceReachabilityGapsJsonlPath);
    assert(reachabilityRows.length === 1, "source reachability gaps should be durable JSONL");
    assert(reachabilityRows[0].effectSiteId === "site:http:response:1", "reachability gap should expose effectSiteId");
    assert(reachabilityRows[0].occurrenceId === "occ:http:response:1", "reachability gap should expose occurrenceId");
    assert(reachabilityRows[0].reachableGapChain?.reason === "call_edge_materialization_missing_or_blocked_before_source_method", "reachability gap should include materialization-backed chain reason");
    const callEdgeRows = readJsonl(layout.callEdgeMaterializationLedgerJsonlPath);
    assert(callEdgeRows.length === 1, "call edge materialization ledger should be durable JSONL");
    assert(callEdgeRows[0].reason === "missing_param_destination_nodes", "call edge materialization row should preserve blocked reason");
    const transferRows = readJsonl(layout.transferSemanticSiteConsumptionJsonlPath);
    assert(transferRows.length === 1, "transfer consumption should be durable JSONL");
    assert(transferRows[0].acceptedTransferSiteCount === 1, "transfer consumption should expose accepted transfer site count");
    assert(transferRows[0].resolvedTransferSiteCount === 1, "transfer consumption should expose resolved transfer endpoint count");
    assert(transferRows[0].blockedReason === "from_endpoint_not_tainted_or_path_mismatch", "transfer consumption should expose exact blocked reason");
    assert(readJsonl(layout.sanitizerSemanticSiteConsumptionJsonlPath).length === 1, "sanitizer consumption should be durable JSONL");
    const moduleRows = readJsonl(layout.moduleSemanticSiteConsumptionJsonlPath);
    assert(moduleRows.length === 1, "module consumption should be durable JSONL");
    assert(moduleRows[0].acceptedModuleSiteCount === 1, "module consumption should expose accepted module site count");
    assert(moduleRows[0].resolvedModuleSiteCount === 1, "module consumption should expose resolved module endpoint count");
    assert(moduleRows[0].blockedReason === "accepted_module_sites_not_scheduled_or_no_fact_endpoint_match", "module consumption should expose exact blocked reason");
    const ordinaryRows = readJsonl(layout.ordinaryPropagationGapsJsonlPath);
    assert(ordinaryRows.length >= 6, "ordinary propagation gaps should be durable JSONL");
    const ordinaryFamilies = new Set(ordinaryRows.map(row => row.gapFamily));
    for (const family of ["field", "container", "JSON", "callback", "parser", "result"]) {
        assert(ordinaryFamilies.has(family), `ordinary propagation gaps should classify ${family} gaps`);
    }

    const llmCoverage = readJson(layout.officialCoverageForLlmFilteringJsonPath);
    assert(llmCoverage.source === "dynamic_registry_coverage_ledger", "LLM filtering coverage must come from dynamic coverage ledger");
    assert(llmCoverage.filterPolicy.hardcodedOfficialApiNames === false, "LLM filtering artifact must not rely on hardcoded official API names");
    assert(llmCoverage.acceptedCanonicalApiIds.includes("official:@ohos.net.http/HttpRequest.request"), "LLM coverage should expose registry-derived accepted IDs");

    const graph = buildTraceGraph(
        {
            runId: "c6-fixture",
            project: "fixture",
            engineVersion: "test",
            assetVersion: "test",
            configHash: "test",
            startedAt: "2026-06-26T00:00:00.000Z",
            completedAt: "2026-06-26T00:00:01.000Z",
            status: "completed",
        },
        [{
            id: "f:remote",
            label: "source_rule:remote",
            pagNode: 1,
            context: 0,
            value: "remote",
            stmt: "remote = input",
        }, {
            id: "f:http",
            label: "source_rule:remote",
            pagNode: 2,
            context: 0,
            value: "http.request",
            stmt: "http.request(remote)",
        }, {
            id: "f:secret",
            label: "source_rule:secret",
            pagNode: 3,
            context: 0,
            value: "secret",
            stmt: "secret = input",
        }],
        [{
            id: "e:remote-http",
            fromFact: "f:remote",
            toFact: "f:http",
            stage: "sink",
            producer: "sink",
            reason: "sink hit",
            status: "emitted",
        }],
        [{
            id: "g:secret-fs",
            fromFact: "f:secret",
            stage: "ordinary",
            producer: "ordinary",
            gateKind: "propagation",
            attempted: true,
            matched: false,
            emitted: false,
            skippedReason: "missing_object_field_load",
        }],
    );
    writeJson(layout.traceGraphJsonPath, graph);

    const ledgerPath = path.join(runDir, "expected_flows.md");
    fs.writeFileSync(ledgerPath, [
        "| flow_id | class | scope | source | propagation | sink | judgement |",
        "|---|---|---|---|---|---|---|",
        "| F01 | normal_business_flow | official-direct | remote |  | http.request | should hit |",
        "| F02 | vulnerability_flow | official-direct | secret |  | fs.write | should miss |",
        "| F10 | vulnerability_flow | official-direct | remote video object | router params | hilog.error | manual overlay should hit |",
        "",
    ].join("\n"), "utf-8");
    assert(parseExpectedFlowLedger(ledgerPath).length === 3, "Markdown ledger parser should read three expected flows");

    const provisionalReport = generateExpectedFlowGapReport({
        project: "fixture",
        ledgerPath,
        runDir,
        sourceRoot: runDir,
    });
    assert(provisionalReport.evaluationStatus === "provisional", "report without manual overlay should be provisional");
    assert(provisionalReport.requiresManualReview === true, "report without manual overlay should require manual review");
    assert(provisionalReport.summary.total === 3, "gap report should preserve per-flow cardinality");
    assert(provisionalReport.summary.hit === 0, "provisional report should not expose final hit count");
    assert(provisionalReport.summary.miss === 0, "provisional report should not expose final miss count");
    assert(provisionalReport.summary.requiresManualReview === 3, "all expected flows should require manual review without overlay");
    assert(provisionalReport.summary.automated.hit === 1, "automated provisional summary should still expose trace hits");
    assert(provisionalReport.summary.automated.miss === 2, "automated provisional summary should still expose trace misses");
    const provisionalMiss = provisionalReport.records.find((record: any) => record.flowId === "F02");
    assert(provisionalMiss?.automatedGapLayer === "ordinary_propagation", `F02 automated layer should map to ordinary_propagation, got ${provisionalMiss?.automatedGapLayer}`);
    assert(provisionalMiss?.expectedFlowVerdict === "requires_manual_review", "F02 should require manual review without overlay");

    const markdownOverlayPath = path.join(runDir, "animez_style_manual_overlay.md");
    fs.writeFileSync(markdownOverlayPath, [
        "| raw_id | expected_flow_id | raw source -> raw sink | manual mapping | manual_verdict | countability | evidence_refs | 人工理由 |",
        "|---|---|---|---|---|---|---|---|",
        "| R04 |  | `VideoDetailPage.router.getParams()` -> `hilog.debug` | R09 duplicate | duplicate | duplicate | raw:R04 | debug sink is a duplicate of the confirmed error sink. |",
        "| R05 |  | `TextInput.onChange` -> `hilog.debug` | R10 duplicate | duplicate | duplicate | raw:R05 | debug sink is a duplicate of the confirmed error sink. |",
        "| R06 |  | `LocalVideoPlayerPage.router.getParams()['episode']` -> `hilog.debug` | R11 duplicate | duplicate | duplicate | raw:R06 | debug sink is a duplicate of the confirmed error sink. |",
        "| R07 |  | `VideoDetailPage.router.getParams()['sourceKey']` -> `hilog.debug` | R12 duplicate | duplicate | duplicate | raw:R07 | debug sink is a duplicate of the confirmed error sink. |",
        "| R08 |  | `VideoDetailPage.router.getParams()['url']` -> `hilog.debug` | R13 duplicate | duplicate | duplicate | raw:R08 | debug sink is a duplicate of the confirmed error sink. |",
        "| R09 | F10 | `VideoDetailPage.router.getParams()` -> `Logger.e` -> `hilog.error` | F10 | confirmed_expected_hit | countable | raw:R09 | router params reach public hilog through the project wrapper. |",
        "| R10 | F01 | `TextInput.onChange` -> `doSearch(keyword)` -> `Logger.e` -> `hilog.error` | F01 | confirmed_expected_hit | countable | raw:R10 | search keyword reaches public hilog through the project wrapper. |",
        "| R14 |  | `VideoDetailPage.router.getParams()` -> `hilog.warn` | R09 duplicate | duplicate | duplicate | raw:R14 | warn sink is a duplicate of the confirmed error sink. |",
        "| R15 |  | `TextInput.onChange` -> `hilog.warn` | R10 duplicate | duplicate | duplicate | raw:R15 | warn sink is a duplicate of the confirmed error sink. |",
        "| R16 |  | `LocalVideoPlayerPage.router.getParams()['episode']` -> `hilog.warn` | R11 duplicate | duplicate | duplicate | raw:R16 | warn sink is a duplicate of the confirmed error sink. |",
        "| R17 |  | `VideoDetailPage.router.getParams()['sourceKey']` -> `hilog.warn` | R12 duplicate | duplicate | duplicate | raw:R17 | warn sink is a duplicate of the confirmed error sink. |",
        "| R18 |  | `VideoDetailPage.router.getParams()['url']` -> `hilog.warn` | R13 duplicate | duplicate | duplicate | raw:R18 | warn sink is a duplicate of the confirmed error sink. |",
        "",
    ].join("\n"), "utf-8");
    const markdownOverlayReport = generateExpectedFlowGapReport({
        project: "fixture",
        ledgerPath,
        runDir,
        sourceRoot: runDir,
        manualOverlayPath: markdownOverlayPath,
        outputDir: path.join(runDir, "audit_markdown_overlay"),
    });
    assert(markdownOverlayReport.summary.hit === 2, "F01 and F10 should count as confirmed hits from raw overlay");
    assert(markdownOverlayReport.summary.miss === 0, "false-positive duplicate raw flows must not count as expected misses");
    assert(markdownOverlayReport.summary.requiresManualReview === 1, "uncovered expected flow should still require manual review");
    assert(markdownOverlayReport.rawFlowVerdictSummary.duplicate === 10, "R04-R08/R14-R18 should be counted as duplicate raw flows");
    const f01 = markdownOverlayReport.records.find((record: any) => record.flowId === "F01");
    const f10 = markdownOverlayReport.records.find((record: any) => record.flowId === "F10");
    assert(f01?.status === "hit" && f01?.expectedFlowVerdictSource === "raw_flow_confirmed_hit", "F01 should be a raw-overlay derived hit");
    assert(f10?.status === "hit" && f10?.expectedFlowVerdictSource === "raw_flow_confirmed_hit", "F10 should be a raw-overlay derived hit");
    assert(f01.rawFlowRefs.map((ref: any) => ref.rawId).join(",") === "R10", "only R10 should be linked to F01 as a hit");
    assert(f10.rawFlowRefs.map((ref: any) => ref.rawId).join(",") === "R09", "only R09 should be linked to F10 as a hit");
    assert(f01.countedRawFlowRefs.map((ref: any) => ref.rawId).join(",") === "R10", "only R10 should be counted for F01");
    assert(f10.countedRawFlowRefs.map((ref: any) => ref.rawId).join(",") === "R09", "only R09 should be counted for F10");

    const animeZCurrentOverlayPath = path.join(runDir, "animez_current_manual_verdict_ledger.json");
    writeJson(animeZCurrentOverlayPath, {
        rawFlows: [{
            rawId: "R01",
            verdict: "out_of_scope_valid_or_low_value",
            expectedFlowIds: [],
            traceSkeleton: "WebPage router.getParams title -> ArkUI Text",
            manualReason: "Ledger-external low-value UI flow must not affect expected-flow hit counts.",
        }, {
            rawId: "R02",
            verdict: "out_of_scope_valid_or_low_value",
            expectedFlowIds: [],
            traceSkeleton: "WebPage router.getParams info -> ArkUI Text",
            manualReason: "Ledger-external low-value UI flow must not affect expected-flow hit counts.",
        }, {
            rawId: "R03",
            verdict: "out_of_scope_valid_or_low_value",
            expectedFlowIds: [],
            traceSkeleton: "Search TextInput.onChange -> TextInput state",
            manualReason: "Ledger-external UI state flow must not affect expected-flow hit counts.",
        }, {
            rawId: "R04",
            verdict: "candidate_expected_not_countable",
            expectedFlowIds: ["F10"],
            traceSkeleton: "VideoDetailPage router.getParams line115 -> hilog.error",
            manualReason: "Near F10, but unresolved/incomplete materialization is not countable.",
        }, {
            rawId: "R05",
            verdict: "candidate_expected_not_countable",
            expectedFlowIds: ["F01"],
            traceSkeleton: "Search TextInput.onChange -> Logger.e -> hilog.error",
            manualReason: "Near F01, but truncated path is not countable.",
        }, {
            rawId: "R06",
            verdict: "out_of_scope_valid_or_low_value",
            expectedFlowIds: [],
            traceSkeleton: "LocalVideoPlayerPage router episode -> hilog.error",
            manualReason: "Ledger-external low-value flow must not affect expected-flow hit counts.",
        }, {
            rawId: "R07",
            verdict: "expected_family_or_ledger_variant_not_countable",
            expectedFlowIds: ["F10"],
            traceSkeleton: "VideoDetailPage router params sourceKey -> playVideo -> Logger.e",
            manualReason: "F10 family/ledger variant, not the exact expected flow and not countable.",
        }, {
            rawId: "R08",
            verdict: "expected_family_or_ledger_variant_not_countable",
            expectedFlowIds: ["F10"],
            traceSkeleton: "VideoDetailPage router params url -> playVideo -> Logger.e",
            manualReason: "F10 family/ledger variant, not the exact expected flow and not countable.",
        }],
        expectedFlows: [{
            flowId: "F01",
            verdict: "near_hit_not_countable",
            rawIds: ["R05"],
            traceSkeleton: "Search keyword -> Logger.e -> hilog.error",
            manualReason: "R05 is a near-hit reference only; confirmed hit remains zero.",
        }, {
            flowId: "F02",
            verdict: "miss_propagation",
            rawIds: [],
            traceSkeleton: "Search keyword -> DAO object field -> RDB insert/update",
            manualReason: "Current first breakpoint remains propagation/result; no raw hit.",
        }, {
            flowId: "F10",
            verdict: "near_hit_not_countable",
            rawIds: ["R04", "R07", "R08"],
            traceSkeleton: "Remote VideoInfo fields -> router params -> hilog.error",
            manualReason: "R04/R07/R08 are near-hit references only; confirmed hit remains zero.",
        }],
    });
    const animeZCurrentReport = generateExpectedFlowGapReport({
        project: "AnimeZ",
        ledgerPath,
        runDir,
        sourceRoot: runDir,
        manualOverlayPath: animeZCurrentOverlayPath,
        outputDir: path.join(runDir, "audit_animez_current_overlay"),
    });
    assert(animeZCurrentReport.evaluationStatus === "final", "complete AnimeZ current overlay should produce a final report");
    assert(animeZCurrentReport.summary.hit === 0, "AnimeZ current R04/R05/R07/R08 must not count as confirmed hits");
    assert(animeZCurrentReport.summary.nearHitNotCountable === 2, "F01 and F10 should be near-hit-not-countable expected verdicts");
    assert(animeZCurrentReport.summary.miss === 1, "F02 should remain a miss in the focused fixture");
    assert(animeZCurrentReport.summary.manualReviewOutcome.confirmedHit === 0, "manual outcome should expose zero confirmed hits");
    assert(animeZCurrentReport.summary.manualReviewOutcome.nearHitNotCountable === 2, "manual outcome should expose expected near-hit count");
    assert(animeZCurrentReport.summary.manualReviewOutcome.nearHitUncountableRaw === 4, "manual outcome should expose R04/R05/R07/R08 near-hit raw refs");
    assert(animeZCurrentReport.summary.manualReviewOutcome.ledgerOutsideNoise === 4, "manual outcome should expose R01/R02/R03/R06 ledger-outside noise");
    assert(animeZCurrentReport.summary.manualReviewOutcome.outOfScope === 4, "R01/R02/R03/R06 should be summarized as out-of-scope");
    assert(animeZCurrentReport.rawFlowVerdictSummary.candidate_expected_not_countable === 2, "R04/R05 should be candidate near-hits");
    assert(animeZCurrentReport.rawFlowVerdictSummary.expected_family_or_ledger_variant_not_countable === 2, "R07/R08 should be family/ledger variants");
    assert(animeZCurrentReport.rawFlowClassificationSummary.near_hit_uncountable === 4, "R04/R05/R07/R08 should classify as near-hit uncountable raw refs");
    assert(animeZCurrentReport.rawFlowClassificationSummary.ledger_outside_noise === 4, "R01/R02/R03/R06 should classify as ledger-outside noise");
    assert(animeZCurrentReport.rawFlowVerdictSummary.strict_false_positive === 0, "AnimeZ current overlay has no strict false positives");
    assert(animeZCurrentReport.rawFlowVerdictSummary.duplicate === 0, "AnimeZ current overlay has no duplicates");
    const animeZF01 = animeZCurrentReport.records.find((record: any) => record.flowId === "F01");
    const animeZF10 = animeZCurrentReport.records.find((record: any) => record.flowId === "F10");
    assert(animeZF01.status === "near_hit_not_countable", "F01 should be final near-hit-not-countable");
    assert(animeZF10.status === "near_hit_not_countable", "F10 should be final near-hit-not-countable");
    assert(animeZF01.rawFlowRefs.map((ref: any) => ref.rawId).join(",") === "R05", "F01 should show R05 as related near-hit evidence");
    assert(animeZF10.rawFlowRefs.map((ref: any) => ref.rawId).join(",") === "R04,R07,R08", "F10 should show R04/R07/R08 as related near-hit evidence");
    assert(animeZF01.rawFlowRefs[0].classification === "near_hit_uncountable", "F01 raw ref should expose near-hit uncountable classification");
    assert(animeZF10.rawFlowRefs.every((ref: any) => ref.countability === "uncountable"), "F10 raw refs should expose uncountable countability");
    assert(animeZF01.countedRawFlowRefs.length === 0, "F01 near-hit refs must not be counted");
    assert(animeZF10.countedRawFlowRefs.length === 0, "F10 near-hit refs must not be counted");

    const genericLedgerPath = path.join(runDir, "generic_expected_flows.json");
    writeJson(genericLedgerPath, {
        flows: [{
            flowId: "ui.search.log",
            class: "normal_business_flow",
            scope: "official-direct",
            source: "remote",
            sink: "http.request",
        }, {
            flowId: "store.write",
            class: "ordinary_valid_taint_flow",
            scope: "official-direct",
            source: "secret",
            sink: "fs.write",
        }, {
            flowId: "pending.review",
            class: "ordinary_valid_taint_flow",
            scope: "official-direct",
            source: "manual source",
            sink: "manual sink",
        }],
    });
    const genericOverlayPath = path.join(runDir, "generic_manual_overlay.json");
    writeJson(genericOverlayPath, {
        rawFlows: [{
            rawFlowId: "raw-alpha",
            flowId: "engine-flow-alpha",
            expectedFlowId: "ui.search.log",
            verdict: "confirmed_expected_hit",
            countability: "countable",
            sourceSite: "generic input callback",
            sinkSite: "generic network sink",
            traceSkeleton: "generic input callback -> generic network sink",
            evidenceRefs: ["fixture:raw-alpha"],
            reason: "Explicit raw verdict marks this as a countable expected hit.",
            manualReason: "Non-AnimeZ fixture uses explicit flow ids.",
        }, {
            rawFlowId: "raw-beta",
            flowId: "engine-flow-beta",
            expectedFlowId: "store.write",
            verdict: "candidate_expected_not_countable",
            countability: "uncountable",
            sourceSite: "near source",
            sinkSite: "near sink",
            traceSkeleton: "near source -> near sink",
            evidenceRefs: ["fixture:raw-beta"],
            reason: "Manual review says this is near the expected flow but uncountable.",
            manualReason: "Near-hit raw flow should not add a confirmed expected hit.",
        }, {
            rawFlowId: "raw-gamma",
            flowId: "engine-flow-gamma",
            expectedFlowId: null,
            verdict: "out_of_scope_valid_or_low_value",
            countability: "ledger_outside_noise",
            sourceSite: "outside source",
            sinkSite: "outside sink",
            traceSkeleton: "outside source -> outside sink",
            evidenceRefs: ["fixture:raw-gamma"],
            reason: "Manual review says this raw flow is valid but outside the expected-flow ledger.",
            manualReason: "Ledger-outside raw flow must not affect expected-flow hit or miss counts.",
        }, {
            rawFlowId: "raw-delta",
            flowId: "engine-flow-delta",
            expectedFlowId: "pending.review",
            sourceSite: "pending source",
            sinkSite: "pending sink",
            traceSkeleton: "pending source -> pending sink",
            evidenceRefs: ["fixture:raw-delta"],
            reason: "Missing verdict should remain manual-review only.",
        }],
        expectedFlows: [{
            flowId: "store.write",
            verdict: "near_hit_not_countable",
            rawIds: ["raw-beta"],
            sourceSite: "near source",
            sinkSite: "near sink",
            traceSkeleton: "near source -> near sink",
            manualReason: "Storage flow has only a manually declared near-hit and remains uncountable.",
        }],
    });
    const genericReport = generateExpectedFlowGapReport({
        project: "non-animez-fixture",
        ledgerPath: genericLedgerPath,
        runDir,
        sourceRoot: runDir,
        manualOverlayPath: genericOverlayPath,
        outputDir: path.join(runDir, "audit_generic_overlay"),
    });
    assert(genericReport.evaluationStatus === "requires_manual_review", "missing raw verdict should keep report in manual-review status");
    assert(genericReport.summary.total === 3, "generic ledger cardinality should be preserved");
    assert(genericReport.summary.hit === 1, "generic raw overlay confirmed hit should count once");
    assert(genericReport.summary.nearHitNotCountable === 1, "generic near-hit should be uncountable");
    assert(genericReport.summary.miss === 0, "generic ledger-outside raw flow must not become an expected miss");
    assert(genericReport.summary.requiresManualReview === 1, "missing raw verdict should leave its expected flow under manual review");
    assert(genericReport.summary.byExpectedFlowVerdict.near_hit_not_countable === 1, "generic expected near-hit verdict should be preserved");
    assert(genericReport.rawFlowVerdictSummary.out_of_scope_valid_or_low_value === 1, "generic ledger-outside raw flow should be counted separately");
    assert(genericReport.rawFlowVerdictSummary.requires_manual_review === 1, "missing raw verdict should default to requires_manual_review");
    assert(genericReport.rawFlowClassificationSummary.confirmed_hit === 1, "generic confirmed hit classification should be counted");
    assert(genericReport.rawFlowClassificationSummary.near_hit_uncountable === 1, "generic near-hit classification should be counted");
    assert(genericReport.rawFlowClassificationSummary.ledger_outside_noise === 1, "generic ledger-outside classification should be counted");
    assert(genericReport.rawFlowClassificationSummary.requires_manual_review === 1, "generic missing verdict classification should be counted");
    const genericHit = genericReport.records.find((record: any) => record.flowId === "ui.search.log");
    const genericNear = genericReport.records.find((record: any) => record.flowId === "store.write");
    const genericPending = genericReport.records.find((record: any) => record.flowId === "pending.review");
    assert(genericHit.countedRawFlowRefs.map((ref: any) => ref.rawFlowId).join(",") === "raw-alpha", "only explicit countable raw flow should be counted as a hit");
    assert(genericHit.countedRawFlowRefs[0].evidenceRefs.join(",") === "fixture:raw-alpha", "counted raw flow should preserve evidence refs");
    assert(genericNear.status === "near_hit_not_countable", "generic near-hit expected flow should be final uncountable");
    assert(genericNear.rawFlowRefs.map((ref: any) => ref.rawFlowId).join(",") === "raw-beta", "near-hit raw ref should be related but uncounted");
    assert(genericNear.countedRawFlowRefs.length === 0, "near-hit raw ref must not be counted");
    assert(genericPending.status === "requires_manual_review", "missing raw verdict must keep the expected flow under manual review");
    assert(genericPending.rawFlowRefs[0].verdict === "requires_manual_review", "raw flow without verdict should default to requires_manual_review");

    const miss = markdownOverlayReport.records.find((record: any) => record.flowId === "F02");
    assert(miss?.gapLayer === "ordinary_propagation", `F02 should map to ordinary_propagation, got ${miss?.gapLayer}`);
    assert(fs.existsSync(layout.expectedFlowGapReportJsonPath), "gap report JSON should be written under audit");
    assert(fs.existsSync(layout.expectedFlowGapReportMarkdownPath), "gap report Markdown should be written under audit");
}

main();
