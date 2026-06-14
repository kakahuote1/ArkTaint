import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import { diffTraceGraphs } from "../../core/trace/TraceGraphDiff";
import { FlowQuery, queryTraceGraph } from "../../core/trace/TraceGraphQuery";
import { appendTraceGraphFragments, buildTraceGraph, TraceGraph, TraceGraphRecorder } from "../../core/trace/TraceGraph";
import { buildSemanticFlowTraceGraph } from "../../core/trace/SemanticFlowTraceGraph";
import { explainTraceResult } from "../../core/trace/TraceExplain";
import { buildSourceCandidateCoverageTraceGraph } from "../../core/trace/SourceCandidateCoverageTraceGraph";
import { buildCurrentAssetCandidateTraceGraph } from "../../cli/ruleFeedbackTrace";
import { resolveTestRunDir } from "../helpers/TestWorkspaceLayout";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function graph(name: string, options: { includeMid?: boolean; includeSink?: boolean; illegal?: boolean }): TraceGraph {
    const facts = [
        {
            id: "f:source",
            label: "source_rule:user_input",
            pagNode: 1,
            context: 0,
            method: "Demo.entry()",
            stmt: "let url = input.value",
            value: "url",
        },
    ];
    if (options.includeMid) {
        facts.push({
            id: "f:mid",
            label: "source_rule:user_input",
            pagNode: 2,
            context: 0,
            method: "Demo.request()",
            stmt: "headers.Authorization = url",
            value: "Authorization",
            fieldPath: ["Authorization"],
        } as any);
    }
    if (options.includeSink) {
        facts.push({
            id: "f:sink",
            label: "source_rule:user_input",
            pagNode: 3,
            context: 0,
            method: "Demo.request()",
            stmt: "http.request(headers.Authorization)",
            value: "http.request",
        } as any);
    }
    if (options.illegal) {
        facts.push({
            id: "f:illegal",
            label: "source_rule:user_input",
            pagNode: 4,
            context: 0,
            method: "Demo.log()",
            stmt: "console.info(headers.Authorization)",
            value: "console.info",
        } as any);
    }
    const edges = [
        {
            id: "e:source-mid",
            fromFact: "f:source",
            toFact: options.includeMid ? "f:mid" : undefined,
            stage: "ordinary" as const,
            producer: "ordinary" as const,
            reason: "field-store",
            status: options.includeMid ? "emitted" as const : "skipped" as const,
            evidence: options.includeMid ? undefined : { skippedReason: "missing_receiver_field_carrier" },
        },
    ];
    if (options.includeSink) {
        edges.push({
            id: "e:mid-sink",
            fromFact: "f:mid",
            toFact: "f:sink",
            stage: "sink",
            producer: "sink",
            reason: "sink-hit:http.request",
            status: "emitted",
        } as any);
    }
    if (options.illegal) {
        edges.push({
            id: "e:mid-illegal",
            fromFact: "f:mid",
            toFact: "f:illegal",
            stage: "ordinary",
            producer: "ordinary",
            reason: "overbroad-field-load",
            status: "emitted",
        } as any);
    }
    const gates = [
        {
            id: "g:carrier",
            label: "source_rule:user_input",
            fromFact: "f:source",
            toFact: options.includeMid ? "f:mid" : undefined,
            stage: "ordinary" as const,
            producer: "ordinary" as const,
            attempted: true,
            matched: options.includeMid === true,
            emitted: options.includeMid === true,
            skippedReason: options.includeMid ? undefined : "missing_receiver_field_carrier",
        },
    ];
    const run = {
            runId: name,
            project: "fixture",
            engineVersion: "test",
            assetVersion: "test",
            configHash: "test",
            startedAt: "2026-06-05T00:00:00.000Z",
            completedAt: "2026-06-05T00:00:01.000Z",
            status: "completed",
        } as const;
    return buildTraceGraph(run, facts as any, edges as any, gates as any);
}

function graphWithForeignSourceOnlySink(): TraceGraph {
    const base = graph("foreign-only-sink", { includeMid: true, includeSink: false });
    base.facts.push({
        id: "f:foreign-sink",
        label: "source_rule:other_input",
        pagNode: 30,
        context: 0,
        method: "Demo.request()",
        stmt: "http.request(headers.Authorization)",
        value: "http.request",
    } as any);
    base.edges.push({
        id: "e:foreign-sink",
        fromFact: "f:source",
        toFact: "f:foreign-sink",
        stage: "sink",
        producer: "sink",
        reason: "foreign sink should not satisfy user_input query",
        status: "emitted",
    } as any);
    return base;
}

function graphWithForeignIllegalOnly(): TraceGraph {
    const base = graph("foreign-illegal", { includeMid: true, includeSink: true, illegal: false });
    base.facts.push({
        id: "f:foreign-illegal",
        label: "source_rule:other_input",
        pagNode: 31,
        context: 0,
        method: "Demo.log()",
        stmt: "console.info(headers.Authorization)",
        value: "console.info",
    } as any);
    base.edges.push({
        id: "e:foreign-illegal",
        fromFact: "f:source",
        toFact: "f:foreign-illegal",
        stage: "ordinary",
        producer: "ordinary",
        reason: "foreign illegal should not satisfy user_input query",
        status: "emitted",
    } as any);
    return base;
}

function graphWithStatementNamedValue(): TraceGraph {
    const base = graph("statement-named-value", { includeMid: true, includeSink: false });
    base.facts.push({
        id: "f:appendLog",
        label: "source_rule:user_input",
        pagNode: 32,
        context: 0,
        method: "LoggerUtil.writeLog(string, string)",
        stmt: "appendLog = parameter1: string",
        value: "parameter1: string",
    } as any);
    base.edges.push({
        id: "e:mid-appendLog",
        fromFact: "f:mid",
        toFact: "f:appendLog",
        stage: "ordinary",
        producer: "ordinary",
        reason: "parameter-value-name-carried-by-stmt",
        status: "emitted",
    } as any);
    base.facts.push({
        id: "f:foreignAppendLog",
        label: "source_rule:other_input",
        pagNode: 33,
        context: 0,
        method: "LoggerUtil.writeLog(string, string)",
        stmt: "appendLog = parameter1: string",
        value: "parameter1: string",
    } as any);
    return base;
}

function graphWithAmbiguousSourceOccurrences(): TraceGraph {
    return buildTraceGraph(
        {
            runId: "ambiguous-source-occurrences",
            project: "fixture",
            engineVersion: "test",
            assetVersion: "test",
            configHash: "test",
            startedAt: "2026-06-05T00:00:00.000Z",
            completedAt: "2026-06-05T00:00:01.000Z",
            status: "completed",
        },
        [{
            id: "f:sourceA",
            label: "source_rule:shared_response",
            pagNode: 101,
            context: 0,
            method: "Demo.sourceA()",
            stmt: "response = api.one()",
            value: "response",
        }, {
            id: "f:sourceB",
            label: "source_rule:shared_response",
            pagNode: 102,
            context: 0,
            method: "Demo.sourceB()",
            stmt: "response = api.two()",
            value: "response",
        }, {
            id: "f:sharedSink",
            label: "source_rule:shared_response",
            pagNode: 103,
            context: 0,
            method: "Demo.sink()",
            stmt: "http.request(response)",
            value: "http.request",
        }] as any,
        [{
            id: "e:sourceB-sink",
            fromFact: "f:sourceB",
            toFact: "f:sharedSink",
            stage: "ordinary",
            producer: "ordinary",
            reason: "selected-source-to-sink",
            status: "emitted",
        }] as any,
        [],
    );
}

const shouldReport: FlowQuery = {
    id: "user-input-to-http",
    kind: "should-report",
    source: { valueContains: "url" },
    expectedWaypoints: [{ fieldPathContains: "Authorization" }],
    sink: { stmtContains: "http.request" },
};

const shouldNotReport: FlowQuery = {
    id: "user-input-to-log",
    kind: "should-not-report",
    source: { valueContains: "url" },
    forbiddenWaypoints: [{ stmtContains: "console.info" }],
    whyNotAllowed: "logger sink is outside this audited flow",
};

function writeWebDavSource(root: string): string {
    const filePath = path.join(root, "entry", "src", "main", "ets", "common", "utils", "webdav", "client.ts");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, [
        "export class WebDavClient {",
        "  buildAuthHeaders() {",
        "    const base64 = Base64Helper.encodeToStringSync(this.config.password)",
        "    return {",
        "      Authorization: `Basic ${base64}`",
        "    }",
        "  }",
        "}",
        "",
    ].join("\n"), "utf-8");
    return filePath;
}

function webdavMissingGraph(): TraceGraph {
    const facts = [
        {
            id: "f:base64",
            label: "WebDavClient.buildAuthHeaders.source",
            pagNode: 101,
            context: 0,
            method: "@ets/common/utils/webdav/client.ts: WebDavClient.buildAuthHeaders()",
            stmt: "base64 = instanceinvoke %19.<@normalized:N&Base64Helper.encodeToStringSync()>(%18)",
            value: "base64",
        },
    ];
    const run = {
            runId: "webdav-before",
            project: "webdav-fixture",
            engineVersion: "test",
            assetVersion: "test",
            configHash: "test",
            startedAt: "2026-06-05T00:00:00.000Z",
            completedAt: "2026-06-05T00:00:01.000Z",
            status: "completed",
        } as const;
    return buildTraceGraph(run, facts as any, [], []);
}

function graphWithModuleLoweringGate(): TraceGraph {
    const base = webdavMissingGraph();
    base.gates.push({
        id: "g:module-lowering",
        label: "WebDavClient.buildAuthHeaders.source",
        fromFact: "f:base64",
        stage: "module_lowering",
        producer: "module",
        gateKind: "lowering",
        scope: "module_hook:project.WebDavClient.authHeaders.objectField:onFact",
        attempted: true,
        matched: false,
        emitted: false,
        skippedReason: "module_hook_no_emission",
        evidence: {
            moduleId: "project.WebDavClient.authHeaders.objectField",
            hook: "onFact",
            calls: 1,
            emissions: 0,
        },
    } as any);
    return buildTraceGraph(base.run, base.facts, base.edges, base.gates);
}

function graphWithProvenanceAndReportingGates(): TraceGraph {
    const base = graph("provenance-reporting", { includeMid: true, includeSink: true });
    base.gates.push({
        id: "g:provenance",
        label: "source_rule:user_input",
        toFact: "f:sink",
        stage: "provenance",
        producer: "provenance",
        gateKind: "path_materialization",
        scope: "path_materialization:f:sink",
        attempted: true,
        matched: false,
        emitted: false,
        blockedReason: "missing_derivation",
        evidence: { materializationStatus: "incomplete" },
    } as any);
    base.gates.push({
        id: "g:reporting",
        label: "source_rule:user_input",
        toFact: "f:sink",
        stage: "reporting",
        producer: "reporting",
        gateKind: "report_emission",
        scope: "reporting:f:sink",
        attempted: true,
        matched: true,
        emitted: false,
        blockedReason: "postsolve_refuted_strong",
        evidence: { judgement: "Refuted-Strong" },
    } as any);
    return buildTraceGraph(base.run, base.facts, base.edges, base.gates);
}

function graphWithIncomingSkippedGateBeforeMissingWaypoint(): TraceGraph {
    const facts = [{
        id: "f:source",
        label: "source_rule:remote_response",
        pagNode: 1001,
        context: 0,
        method: "HomeViewModel.load()",
        stmt: "response = http.request()",
        value: "response",
    }, {
        id: "f:lastReached",
        label: "source_rule:remote_response",
        pagNode: 1002,
        context: 0,
        method: "HomeViewModel.getHomeListByHttp()",
        stmt: "then(result => this.dataList = result)",
        value: "result",
    }];
    const edges = [{
        id: "e:incoming-skipped",
        fromFact: "f:source",
        toFact: "f:lastReached",
        stage: "UDE" as const,
        producer: "UDE" as const,
        reason: "Synthetic-Call",
        status: "skipped" as const,
        evidence: { skippedReason: "unreachable_target" },
    }];
    const gates = [{
        id: "g:incoming-skipped",
        label: "source_rule:remote_response",
        fromFact: "f:source",
        toFact: "f:lastReached",
        stage: "UDE" as const,
        producer: "UDE" as const,
        gateKind: "deferred" as const,
        scope: "Synthetic-Call",
        attempted: true,
        matched: false,
        emitted: false,
        skippedReason: "unreachable_target",
        evidence: { skippedReason: "unreachable_target" },
    }];
    const run = {
        runId: "incoming-skipped-before-missing",
        project: "fixture",
        engineVersion: "test",
        assetVersion: "test",
        configHash: "test",
        startedAt: "2026-06-05T00:00:00.000Z",
        completedAt: "2026-06-05T00:00:01.000Z",
        status: "completed",
    } as const;
    return buildTraceGraph(run, facts as any, edges as any, gates as any);
}

function graphWithCoverageGapOnly(): TraceGraph {
    return buildTraceGraph(
        {
            runId: "coverage-gap",
            project: "coverage-fixture",
            engineVersion: "test",
            assetVersion: "current-assets",
            configHash: "test",
            startedAt: "2026-06-05T00:00:00.000Z",
            completedAt: "2026-06-05T00:00:01.000Z",
            status: "completed",
        },
        [],
        [],
        [{
            id: "g:coverage-gap",
            label: "anchor.project.camera.pick",
            stage: "coverage_ledger",
            producer: "coverage_ledger",
            gateKind: "coverage_query",
            scope: "coverage_ledger:cameraPicker.pick.resultUri",
            attempted: true,
            matched: true,
            emitted: false,
            skippedReason: "not-covered:source endpoint resultUri",
            evidence: {
                surfaceId: "cameraPicker.pick",
                role: "source",
                endpoint: "return.resultUri",
                observedSurface: "cameraPicker.pick()",
            },
        } as any],
    );
}

function graphWithSourceRuleZeroHitGate(): TraceGraph {
    return buildTraceGraph(
        {
            runId: "source-rule-zero-hit",
            project: "source-rule-fixture",
            engineVersion: "test",
            assetVersion: "current-assets",
            configHash: "test",
            startedAt: "2026-06-05T00:00:00.000Z",
            completedAt: "2026-06-05T00:00:01.000Z",
            status: "completed",
        },
        [],
        [],
        [{
            id: "g:source-rule-zero-hit",
            label: "source_rule:getHomeListAxios.return.source",
            stage: "source_seed",
            producer: "rule",
            gateKind: "seed",
            scope: "source_rule:getHomeListAxios.return.source",
            attempted: true,
            matched: false,
            emitted: false,
            skippedReason: "source_rule_zero_hit",
            evidence: {
                ruleId: "getHomeListAxios.return.source",
                sourceKind: "call_return",
                sourceRuleHits: 0,
                zeroHitReason: "source_rule_callsite_outside_allowed_methods",
                matchedCallsiteCount: 2,
                matchedAllowedCallsiteCount: 0,
                matchedExcludedCallsiteCount: 2,
            },
        } as any],
    );
}

function assertRecorderClassifiesPropagationGates(): void {
    const recorder = new TraceGraphRecorder({
        run: {
            runId: "classification",
            project: "fixture",
            engineVersion: "test",
            assetVersion: "test",
            configHash: "test",
        },
    });
    const fakeFact = {
        node: { getID: () => 10 },
        contextID: 0,
        source: "source_rule:user_input",
        field: undefined,
        taintId: "fake:10@0#src=user",
    } as any;
    const fakeTarget = {
        node: { getID: () => 11 },
        contextID: 0,
        source: "source_rule:user_input",
        field: undefined,
        taintId: "fake:11@0#src=user",
    } as any;
    recorder.recordPropagationGate(fakeFact, fakeTarget, {
        reason: "module lowering emitted handoff.put",
        status: "emitted",
    });
    recorder.recordPropagationGate(fakeFact, fakeTarget, {
        reason: "currentness certificate dead",
        status: "blocked",
        blockedReason: "dead_currentness",
    });
    const snapshot = recorder.snapshot({ status: "completed" });
    assert(snapshot.gates.some(gate => gate.stage === "module_lowering" && gate.producer === "module"), "module lowering propagation gate should keep module stage");
    assert(snapshot.gates.some(gate => gate.stage === "OCLFS" && gate.producer === "OCLFS"), "currentness propagation gate should keep OCLFS stage");
}

function assertRecorderTypedSinkAndPostsolveGates(): void {
    const recorder = new TraceGraphRecorder({
        run: {
            runId: "typed-gates",
            project: "fixture",
            engineVersion: "test",
            assetVersion: "test",
            configHash: "test",
        },
    });
    recorder.recordSinkFlow({
        source: "source_rule:user_input",
        sink: { toString: () => "Sink(url)" },
        sinkFactId: "f:sink",
        sinkNodeId: 42,
        sinkFieldPath: ["url"],
        sinkEndpoint: "arg[0]",
        sinkRuleId: "sink.http.request.url",
        toString: () => "flow:user_input->http",
    } as any);
    recorder.recordPostsolveDecision({
        flowId: "flow:user_input->http",
        sinkFactId: "f:sink",
        label: "source_rule:user_input",
        judgement: "Refuted-Strong",
        reason: "postsolve:Refuted-Strong",
    });
    const snapshot = recorder.snapshot({ status: "completed" });
    assert(snapshot.gates.some(gate => gate.stage === "sink" && gate.gateKind === "sink_match" && gate.scope === "sink:f:sink"), "sink flow gate should be typed as sink_match");
    assert(snapshot.gates.some(gate => gate.stage === "postsolve" && gate.gateKind === "postsolve_decision" && gate.scope === "postsolve:f:sink"), "postsolve gate should be typed as postsolve_decision");
}

function assertSemanticFlowTraceGraphGates(): void {
    const asset = {
        id: "asset.semanticflow.project.wrapper",
        plane: "rule",
        status: "schema-valid",
        surfaces: [{
            surfaceId: "asset.semanticflow.project.wrapper.surface",
            kind: "invoke",
            modulePath: "@project/client",
            ownerName: "Client",
            methodName: "send",
            invokeKind: "instance",
            argCount: 1,
            confidence: "certain",
            provenance: { source: "analyzer", importPath: "@project/client" },
        }],
        bindings: [{
            bindingId: "asset.semanticflow.project.wrapper.binding",
            surfaceId: "asset.semanticflow.project.wrapper.surface",
            assetId: "asset.semanticflow.project.wrapper",
            plane: "rule",
            role: "sink",
            endpoint: { base: { kind: "arg", index: 0 } },
            effectTemplateRefs: ["asset.semanticflow.project.wrapper.sink"],
            completeness: "complete",
            confidence: "certain",
        }],
        effectTemplates: [{
            id: "asset.semanticflow.project.wrapper.sink",
            kind: "rule.sink",
            role: "sink",
            value: { base: { kind: "arg", index: 0 } },
            sinkKind: "network",
            confidence: "certain",
        }],
        provenance: { source: "llm", projectId: "semanticflow-test" },
    } as any;
    const semanticGraph = buildSemanticFlowTraceGraph({
        run: {
            runId: "semanticflow-test",
            project: "fixture",
            engineVersion: "test",
            assetVersion: "semanticflow",
            configHash: "test",
            startedAt: "2026-06-05T00:00:00.000Z",
            completedAt: "2026-06-05T00:00:01.000Z",
            status: "completed",
        },
        items: [{
            anchor: {
                id: "anchor.project.client.send",
                owner: "Client",
                surface: "Client.send",
                methodSignature: "@project/client: Client.send(string)",
                filePath: "entry/src/main/ets/client.ets",
                line: 12,
            },
            draftId: "draft.anchor.project.client.send",
            plane: "rule",
            resolution: "resolved",
            asset,
            finalSlice: {
                anchorId: "anchor.project.client.send",
                round: 0,
                template: "owner-slot",
                observations: ["candidateBoundary=project_or_third_party_wrapper_evidence"],
                snippets: [],
            },
            history: [],
        } as any],
        assets: [asset],
        sourceRuns: [{
            sourceDir: "entry",
            absPath: "fixture/entry",
            status: "ok",
            itemCount: 1,
            ruleCandidateCount: 1,
            elapsedMs: 10,
        }],
        promotionResults: [{
            assetId: asset.id,
            fromStatus: "schema-valid",
            toStatus: "reviewed",
            accepted: true,
            reason: "reviewed",
        }],
        summary: { itemCount: 1, assetCount: 1 },
    });
    assert(semanticGraph.gates.some(gate => gate.stage === "preanalysis" && gate.gateKind === "coverage"), "semanticflow source run should become preanalysis coverage gate");
    assert(semanticGraph.gates.some(gate => gate.stage === "semanticflow" && gate.gateKind === "candidate" && gate.emitted), "resolved semanticflow item should emit candidate gate");
    assert(semanticGraph.gates.some(gate => gate.stage === "asset_validation" && gate.gateKind === "validation" && gate.emitted), "valid asset should emit validation gate");
    assert(semanticGraph.gates.some(gate => gate.stage === "asset_promotion" && gate.gateKind === "promotion" && gate.emitted), "promotion result should emit promotion gate");
    assert(semanticGraph.gates.some(gate => gate.stage === "coverage_ledger" && gate.gateKind === "coverage_query"), "semanticflow item should expose coverage ledger gate");
    assert(semanticGraph.gates.some(gate => gate.stage === "semanticflow_llm" && gate.gateKind === "llm_output"), "semanticflow item should expose LLM output gate");
    assert(semanticGraph.coverage.some(record => record.kind === "llm_output"), "semanticflow graph should include coverage records inferred from LLM gates");

    const runtimeGraph = graph("runtime", { includeMid: true });
    const merged = appendTraceGraphFragments(runtimeGraph, [{ graph: semanticGraph, prefix: "semanticflow" }]);
    assert(merged.facts.some(fact => fact.id === "f:source"), "append must preserve runtime fact ids");
    assert(merged.gates.some(gate => gate.id.startsWith("semanticflow:") && gate.stage === "semanticflow"), "append must prefix semanticflow gates");
}

function assertCurrentAssetCandidateCoverageGraph(): void {
    const candidate = {
        callee_signature: "@dimina/Bridges/DMPWebViewProxy.ets: DMPWebViewProxy.invoke(Message)",
        method: "invoke",
        invokeKind: "instance",
        argCount: 1,
        sourceFile: "dimina/src/main/ets/HybridContainer/DMPWebViewProxy.ets",
        count: 2,
        topEntries: ["EntryAbility.onCreate"],
        category: "C2_API_MODELING_CANDIDATE",
        reason: "Callsite matches neither non-transfer helper nor framework-gap traits and is retained as a neutral API modeling candidate.",
        evidence: ["method=invoke", "sourceFile=dimina/src/main/ets/HybridContainer/DMPWebViewProxy.ets"],
        semanticFocus: "bridge_source_to_network_sink",
    } as any;
    const traceGraph = buildCurrentAssetCandidateTraceGraph({
        run: {
            runId: "current-assets-candidate-test",
            project: "dimina-fixture",
            engineVersion: "test",
            assetVersion: "current-assets",
            configHash: "test",
            startedAt: "2026-06-05T00:00:00.000Z",
            completedAt: "2026-06-05T00:00:01.000Z",
            status: "completed",
        },
        report: {
            generatedAt: "2026-06-05T00:00:00.000Z",
            repo: "dimina-fixture",
            sourceDirs: ["dimina/src/main/ets"],
            ruleLayerStatus: [{
                name: "project",
                path: "tmp/generated/project/semanticflow/rules",
                applied: true,
                exists: true,
                source: "auto",
                packId: "semanticflow",
                sourceRuleIds: ["project.wrapper.response.source"],
                sinkRuleIds: ["project.wrapper.arg0.sink"],
            }],
            summary: {
                ruleFeedback: {
                    zeroHitRules: {
                        source: { "project.wrapper.response.source": 0 },
                        sink: { "project.wrapper.arg0.sink": 0 },
                        transfer: {},
                    },
                },
            },
        } as any,
        artifacts: {
            items: [candidate],
            categoryCount: {
                C0_NON_TRANSFER_HELPER: 0,
                C1_UI_NOISE: 0,
                C2_API_MODELING_CANDIDATE: 1,
                C3_FRAMEWORK_GAP: 0,
            },
            apiModelingCandidates: [candidate],
        },
    });
    assert(traceGraph.gates.some(gate => gate.stage === "preanalysis" && gate.gateKind === "observed_surface"), "candidate graph should expose observed surface gate");
    assert(traceGraph.gates.some(gate => gate.stage === "coverage_ledger" && gate.gateKind === "coverage_query" && !gate.emitted), "candidate graph should expose coverage-ledger gap gate");
    assert(traceGraph.gates.some(gate => gate.stage === "semanticflow" && gate.gateKind === "candidate" && gate.skippedReason === "semanticflow_not_invoked_for_current_assets_trace"), "candidate graph should expose queued semanticflow candidate gate");
    assert(traceGraph.coverage.some(record => record.kind === "coverage_query" && record.status === "gap" && record.reason === "current_assets_not_covered_by_reviewed_replayed_or_official_asset"), "candidate graph should expose not-covered gap coverage record");
    assert(traceGraph.gates.some(gate => gate.stage === "source_seed" && gate.skippedReason === "source_rule_zero_hit" && gate.evidence?.ruleId === "project.wrapper.response.source"), "candidate graph should expose zero-hit source rule gate");
    assert(traceGraph.gates.some(gate => gate.stage === "sink_candidate" && gate.skippedReason === "sink_rule_zero_hit" && gate.evidence?.ruleId === "project.wrapper.arg0.sink"), "candidate graph should expose zero-hit sink rule gate");
    assert(traceGraph.coverage.some(record => record.kind === "source_seed" && record.status === "skipped" && record.reason === "source_rule_zero_hit"), "candidate graph should expose zero-hit source rule coverage");
    assert(traceGraph.coverage.some(record => record.kind === "sink_candidate" && record.status === "skipped" && record.reason === "sink_rule_zero_hit"), "candidate graph should expose zero-hit sink rule coverage");

    const query: FlowQuery = {
        id: "dimina-bridge-source",
        kind: "should-report",
        source: { valueContains: "DMPWebViewProxy" },
        sink: { valueContains: "DMPContainerBridgesModuleHttp" },
    };
    const result = queryTraceGraph(traceGraph, query);
    const explanation = explainTraceResult(traceGraph, query, result);
    assert(result.nearbyCoverage.some(record => record.subject.includes("DMPWebViewProxy")), "flow query should find current-assets candidate coverage");
    assert(explanation.primaryLayer === "coverage_ledger" || explanation.primaryLayer === "semanticflow", "candidate gap should explain source-unseeded FN from coverage graph");
    assert(explanation.missingGateCoverage === false, "candidate coverage graph should prevent missingGateCoverage fallback");
}

function assertSourceCandidateCoverageGraph(): void {
    const traceGraph = buildSourceCandidateCoverageTraceGraph({
        run: {
            runId: "source-candidate-coverage-test",
            project: "fluidmarkdown-fixture",
            engineVersion: "test",
            assetVersion: "current-assets",
            configHash: "test",
            startedAt: "2026-06-06T00:00:00.000Z",
            completedAt: "2026-06-06T00:00:01.000Z",
            status: "completed",
        },
        sourceDir: "HarmonyOS/markdown/src/main/ets",
        candidates: [{
            kind: "decorated_field",
            subject: "decorated_field|Markdown|content|Param",
            ownerClass: "Markdown",
            targetName: "content",
            methodNames: ["Markdown.onContentChange"],
            methodSignatures: ["@project/HarmonyOS/markdown/src/main/ets/markdown.ets: Markdown.onContentChange(ChangeEvent)"],
            decoratorKinds: ["Param"],
            endpoint: "field.content",
            reason: "component decorator field is an external input candidate but no current source seed covers it",
        }, {
            kind: "formal_parameter",
            subject: "formal_parameter|MarkdownController.update|0|content",
            ownerClass: "MarkdownController",
            targetName: "content",
            methodNames: ["MarkdownController.update"],
            methodSignatures: ["@project/HarmonyOS/markdown/src/main/ets/markdown.ets: MarkdownController.update(string)"],
            paramIndex: 0,
            paramName: "content",
            endpoint: "arg0",
            reason: "payload-like formal parameter is a source candidate but no current source seed covers it",
        }],
    });

    const contentQuery: FlowQuery = {
        id: "fluidmarkdown-content-source",
        kind: "should-report",
        source: { methodContains: "Markdown.onContentChange", valueContains: "content" },
        sink: { valueContains: "http.request" },
    };
    const contentResult = queryTraceGraph(traceGraph, contentQuery);
    const contentExplanation = explainTraceResult(traceGraph, contentQuery, contentResult);
    assert(contentResult.verdict === "missing", "source-candidate query should still be missing under current assets");
    assert(contentResult.nearbyCoverage.some(record => record.kind === "coverage_query" && record.status === "gap"), "source-candidate query should expose a coverage query gap");
    assert(contentExplanation.missingGateCoverage === false, "source-candidate coverage should prevent missingGateCoverage fallback");
    assert(contentExplanation.primaryLayer === "coverage_ledger", "source-candidate gap should be attributed to coverage ledger");

    const controllerQuery: FlowQuery = {
        id: "fluidmarkdown-controller-content-source",
        kind: "should-report",
        source: { methodContains: "MarkdownController", valueContains: "content" },
        sink: { valueContains: "console.info" },
    };
    const controllerResult = queryTraceGraph(traceGraph, controllerQuery);
    const controllerExplanation = explainTraceResult(traceGraph, controllerQuery, controllerResult);
    assert(controllerResult.nearbyCoverage.some(record => record.subject.includes("formal_parameter")), "formal parameter source candidate should be queryable");
    assert(controllerExplanation.missingGateCoverage === false, "formal parameter coverage should explain source-unseeded FN");
}

function writeJson(filePath: string, value: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
}

function main(): void {
    const before = graph("before", { includeMid: false });
    const after = graph("after", { includeMid: true, includeSink: true });
    const illegal = graph("illegal", { includeMid: true, includeSink: true, illegal: true });

    const missing = queryTraceGraph(before, shouldReport);
    assert(missing.verdict === "missing", "should-report query must find first missing waypoint");
    assert(missing.firstMissing?.fieldPathContains === "Authorization", "first missing waypoint should be Authorization carrier");
    assert(missing.primaryLayer === "ordinary", "missing carrier should map to ordinary layer");
    assert(missing.nearbyGates.some(gate => gate.skippedReason === "missing_receiver_field_carrier"), "nearby gate should expose skipped reason");

    const reached = queryTraceGraph(after, shouldReport);
    assert(reached.verdict === "reached", "after graph should close expected flow");

    const ambiguousSourceGraph = graphWithAmbiguousSourceOccurrences();
    const ambiguousSourceQuery: FlowQuery = {
        id: "ambiguous-shared-source",
        kind: "should-report",
        source: { methodContains: "Demo.source" },
        sink: { stmtContains: "http.request" },
    };
    const ambiguousSourceResult = queryTraceGraph(ambiguousSourceGraph, ambiguousSourceQuery);
    const ambiguousSourceExplanation = explainTraceResult(ambiguousSourceGraph, ambiguousSourceQuery, ambiguousSourceResult);
    assert(ambiguousSourceResult.verdict === "source-ambiguous", "query must not auto-select the first matching source occurrence");
    assert(ambiguousSourceResult.lastReached === undefined, "ambiguous source result must not fabricate a lastReached fact");
    assert(ambiguousSourceExplanation.causeKind === "trace.source_ambiguous", "ambiguous source should explain anchor ambiguity instead of a downstream layer");
    assert(ambiguousSourceExplanation.primaryLayer === undefined, "ambiguous source must not assign UDE/OCLFS/SemanticFlow/ordinary responsibility");

    const exactSourceResult = queryTraceGraph(ambiguousSourceGraph, {
        ...ambiguousSourceQuery,
        id: "exact-shared-source",
        source: { id: "f:sourceB" },
    });
    assert(exactSourceResult.verdict === "reached", "exact source id should disambiguate and allow normal reachability proof");

    const foreignOnlySink = queryTraceGraph(graphWithForeignSourceOnlySink(), shouldReport);
    assert(foreignOnlySink.verdict === "missing", "query must not combine a user_input source with another source's sink");
    assert(foreignOnlySink.firstMissing?.stmtContains === "http.request", "foreign sink must remain missing for scoped source label");

    const fp = queryTraceGraph(illegal, shouldNotReport);
    assert(fp.verdict === "illegal-propagation", "should-not-report query must identify illegal propagation");
    assert(fp.responsibleEdge?.reason === "overbroad-field-load", "responsible edge should be the illegal emitted edge");
    assert(fp.whyNotAllowed === "logger sink is outside this audited flow", "query must preserve whyNotAllowed");

    const foreignIllegal = queryTraceGraph(graphWithForeignIllegalOnly(), shouldNotReport);
    assert(foreignIllegal.verdict === "reached", "should-not-report must ignore forbidden facts from other source labels");

    const statementNamedValue = queryTraceGraph(graphWithStatementNamedValue(), {
        id: "statement-named-value",
        kind: "should-report",
        source: { valueContains: "url" },
        expectedWaypoints: [{ fieldPathContains: "Authorization" }],
        sink: { methodContains: "LoggerUtil.writeLog", valueContains: "appendLog" },
    });
    assert(statementNamedValue.verdict === "reached", "valueContains should match value-bearing names that appear in the TraceFact statement");
    assert(statementNamedValue.lastReached?.id === "f:appendLog", "query should still respect the scoped source label");

    const webdavRoot = path.join(resolveTestRunDir("analyze", "full_trace_graph_cli"), "webdav_project");
    writeWebDavSource(webdavRoot);
    const webdavQuery: FlowQuery = {
        id: "webdav-auth-header",
        kind: "should-report",
        source: { valueContains: "base64" },
        expectedWaypoints: [{ valueContains: "Authorization" }],
        sink: { stmtContains: "WebDavLogger" },
    };
    const webdavResult = queryTraceGraph(webdavMissingGraph(), webdavQuery);
    assert(webdavResult.verdict === "missing", "webdav fixture should be a missing flow");
    const webdavExplanation = explainTraceResult(webdavMissingGraph(), webdavQuery, webdavResult, { projectRoot: webdavRoot });
    assert(
        webdavExplanation.causeKind === "ordinary.return_object_field_not_emitted",
        `webdav explanation should identify returned object field propagation, got ${webdavExplanation.causeKind}`,
    );
    assert(webdavExplanation.inspectedScope?.sourceFile?.endsWith("client.ts"), "webdav explanation should resolve source file");

    const moduleGateGraph = graphWithModuleLoweringGate();
    const moduleGateResult = queryTraceGraph(moduleGateGraph, webdavQuery);
    const moduleGateExplanation = explainTraceResult(moduleGateGraph, webdavQuery, moduleGateResult, { projectRoot: webdavRoot });
    assert(moduleGateExplanation.primaryLayer === "module_lowering", "module lowering gate should become the primary layer");
    assert(moduleGateExplanation.causeKind === "module.effect_or_lowering_not_emitted", "module lowering gate should explain module cause");
    assert(
        moduleGateExplanation.responsibleCoverage?.reason === "module_hook_no_emission"
        || moduleGateExplanation.responsibleGate?.skippedReason === "module_hook_no_emission",
        "module lowering skipped reason should be preserved by coverage or gate explanation",
    );

    const provenanceGraph = graphWithProvenanceAndReportingGates();
    const provenanceResult = queryTraceGraph(provenanceGraph, {
        id: "path-materialization-gap",
        kind: "diagnostic",
        source: { valueContains: "url" },
        expectedWaypoints: [{ fieldPathContains: "Authorization" }],
        sink: { stmtContains: "http.request" },
    });
    assert(provenanceResult.nearbyGates.some(gate => gate.stage === "provenance"), "provenance gate should be near reached sink fact");
    assert(provenanceResult.nearbyGates.some(gate => gate.stage === "reporting"), "reporting gate should be near reached sink fact");

    const incomingSkipped = graphWithIncomingSkippedGateBeforeMissingWaypoint();
    const incomingSkippedQuery: FlowQuery = {
        id: "remote-response-to-router-push",
        kind: "should-report",
        source: { valueContains: "response" },
        expectedWaypoints: [{ methodContains: "HomeViewModel.getHomeListByHttp" }],
        sink: { methodContains: "Router.[static]push", valueContains: "playUrl" },
    };
    const incomingSkippedResult = queryTraceGraph(incomingSkipped, incomingSkippedQuery);
    const incomingSkippedExplanation = explainTraceResult(incomingSkipped, incomingSkippedQuery, incomingSkippedResult);
    assert(incomingSkippedResult.verdict === "missing", "router push fixture should still be a missing flow");
    assert(incomingSkippedResult.firstMissing?.methodContains === "Router.[static]push", "missing waypoint should remain the later router push");
    assert(incomingSkippedExplanation.responsibleGate === undefined, "incoming skipped gate into lastReached must not explain a later missing waypoint");
    assert(incomingSkippedExplanation.missingGateCoverage === true, "missing later waypoint without scoped gate should request gate coverage instead of blaming incoming edge");

    assertRecorderClassifiesPropagationGates();
    assertRecorderTypedSinkAndPostsolveGates();
    assertSemanticFlowTraceGraphGates();
    assertCurrentAssetCandidateCoverageGraph();
    assertSourceCandidateCoverageGraph();

    const coverageGapQuery: FlowQuery = {
        id: "camera-pick-result-uri",
        kind: "should-report",
        source: { valueContains: "cameraPicker.pick" },
        sink: { valueContains: "handleFileList" },
    };
    const coverageGapGraph = graphWithCoverageGapOnly();
    const coverageGapResult = queryTraceGraph(coverageGapGraph, coverageGapQuery);
    const coverageGapExplanation = explainTraceResult(coverageGapGraph, coverageGapQuery, coverageGapResult);
    assert(coverageGapResult.nearbyCoverage.length > 0, "source-missing FN should be explained by semantic coverage records");
    assert(coverageGapExplanation.causeKind === "coverage.role_endpoint_guard_gap", `coverage gap should map to coverage cause, got ${coverageGapExplanation.causeKind}`);
    assert(coverageGapExplanation.missingGateCoverage === false, "coverage graph evidence should prevent missingGateCoverage fallback");

    const zeroHitGraph = graphWithSourceRuleZeroHitGate();
    const zeroHitQuery: FlowQuery = {
        id: "getHomeListAxios-zero-hit",
        kind: "should-report",
        source: { labelContains: "getHomeListAxios.return.source" },
        sink: { valueContains: "video.src" },
    };
    const zeroHitResult = queryTraceGraph(zeroHitGraph, zeroHitQuery);
    const zeroHitExplanation = explainTraceResult(zeroHitGraph, zeroHitQuery, zeroHitResult);
    assert(zeroHitResult.verdict === "missing", "zero-hit source rule should still be a missing flow");
    assert(zeroHitResult.nearbyGates.some(gate => gate.skippedReason === "source_rule_zero_hit"), "zero-hit source rule gate should be queryable");
    assert(zeroHitResult.nearbyCoverage.some(record => record.kind === "source_seed" && record.status === "skipped"), "zero-hit source rule should become source_seed coverage");
    assert(zeroHitExplanation.primaryLayer === "source_seed", "zero-hit source rule should be attributed to source seeding");
    assert(zeroHitExplanation.causeKind === "arkmain.source_seed_allowed_method_not_reached", `zero-hit source rule should expose allowed-method cause, got ${zeroHitExplanation.causeKind}`);
    assert(zeroHitExplanation.missingGateCoverage === false, "zero-hit source rule gate should prevent missing gate fallback");

    const zeroHitMethodStmtQuery: FlowQuery = {
        id: "getHomeListAxios-zero-hit-method-stmt",
        kind: "should-report",
        source: { methodContains: "getHomeListAxios", stmtContains: "axiosClient.get" },
        sink: { valueContains: "video.src" },
    };
    const zeroHitMethodStmtResult = queryTraceGraph(zeroHitGraph, zeroHitMethodStmtQuery);
    const zeroHitMethodStmtExplanation = explainTraceResult(zeroHitGraph, zeroHitMethodStmtQuery, zeroHitMethodStmtResult);
    assert(zeroHitMethodStmtResult.nearbyGates.some(gate => gate.skippedReason === "source_rule_zero_hit"), "method+stmt query should still attach rule-level zero-hit source gate");
    assert(zeroHitMethodStmtResult.nearbyCoverage.some(record => record.kind === "source_seed" && record.reason === "source_rule_zero_hit"), "method+stmt query should attach source_seed zero-hit coverage");
    assert(zeroHitMethodStmtExplanation.primaryLayer === "source_seed", "method+stmt zero-hit query should prefer source seeding over earlier coverage gaps");
    assert(zeroHitMethodStmtExplanation.repairHint?.includes("reachable-method activation"), "method+stmt zero-hit query should point to reachable-method activation");

    const diff = diffTraceGraphs(before, after, [shouldReport]);
    assert(diff.summary.closedQueries === 1, "diff should mark should-report query closed");
    assert(diff.addedFacts.some(fact => fact.id === "f:mid"), "diff should include newly reached waypoint fact");

    const regress = diffTraceGraphs(after, before, [shouldReport]);
    assert(regress.summary.regressedQueries === 1, "diff should detect regression when graph loses reached flow");

    const outDir = resolveTestRunDir("analyze", "full_trace_graph_cli");
    writeJson(path.join(outDir, "before.json"), before);
    writeJson(path.join(outDir, "after.json"), after);
    writeJson(path.join(outDir, "queries.json"), [shouldReport, shouldNotReport]);
    const queryResult = spawnSync(process.execPath, [
        "out/cli/trace_graph.js",
        "query",
        "--graph", path.join(outDir, "after.json"),
        "--queries", path.join(outDir, "queries.json"),
        "--outputDir", path.join(outDir, "query"),
    ], { encoding: "utf-8" });
    assert(queryResult.status === 0, `trace_graph query failed: ${queryResult.stderr}`);
    const cliQueryOutput = JSON.parse(fs.readFileSync(path.join(outDir, "query", "flow_query_results.json"), "utf-8"));
    assert(cliQueryOutput.results[0].explanation, "query CLI should attach TraceExplanation");
    const diffResult = spawnSync(process.execPath, [
        "out/cli/trace_graph.js",
        "diff",
        "--before", path.join(outDir, "before.json"),
        "--after", path.join(outDir, "after.json"),
        "--queries", path.join(outDir, "queries.json"),
        "--outputDir", path.join(outDir, "diff"),
    ], { encoding: "utf-8" });
    assert(diffResult.status === 0, `trace_graph diff failed: ${diffResult.stderr}`);
    assert(fs.existsSync(path.join(outDir, "query", "flow_query_results.json")), "query CLI should write results");
    assert(fs.existsSync(path.join(outDir, "diff", "trace_diff.json")), "diff CLI should write results");
}

main();
