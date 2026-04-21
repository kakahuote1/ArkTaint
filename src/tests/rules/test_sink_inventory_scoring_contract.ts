import { TaintFlow } from "../../core/kernel/model/TaintFlow";
import { SinkRule } from "../../core/rules/RuleSchema";
import { summarizeSinkInventoryFlows } from "../helpers/SinkInventoryScoring";
import { aggregateReport, createSourceSummary } from "../helpers/SmokeReportUtils";
import { CliOptions, EntrySmokeResult, ProjectSmokeResult } from "../helpers/SmokeTypes";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function makeFlow(source: string, sinkRuleId: string, sinkEndpoint: string): TaintFlow {
    const fakeSink = {
        toString: (): string => `${sinkRuleId}(${sinkEndpoint})`,
    } as any;
    return new TaintFlow(source, fakeSink, {
        sinkRuleId,
        sinkEndpoint,
    });
}

async function main(): Promise<void> {
    const sinkRules = [
        { id: "sink.target", family: "sink.demo.target" },
        { id: "sink.other", family: "sink.demo.other" },
    ] as SinkRule[];
    const flows = [
        makeFlow("source_rule:a", "sink.target", "arg0"),
        makeFlow("source_rule:a", "sink.other", "arg1"),
    ];
    const sinkSummary = summarizeSinkInventoryFlows(flows, sinkRules, ["sink.target"]);

    assert(sinkSummary.inventoryFlowCount === 2, `expected 2 inventory flows, got ${sinkSummary.inventoryFlowCount}`);
    assert(sinkSummary.targetFlowCount === 1, `expected 1 target flow, got ${sinkSummary.targetFlowCount}`);
    assert(sinkSummary.spilloverFlowCount === 1, `expected 1 spillover flow, got ${sinkSummary.spilloverFlowCount}`);
    assert(sinkSummary.detectedTarget, "expected detectedTarget=true");
    assert(sinkSummary.sinkRuleHits["sink.target"] === 1, "expected sink.target hit");
    assert(sinkSummary.sinkFamilyHits["sink.demo.target"] === 1, "expected sink.demo.target family hit");
    assert(sinkSummary.sinkEndpointHits["arg0"] === 1, "expected arg0 endpoint hit");

    const entry: EntrySmokeResult = {
        sourceDir: "entry/src/main/ets",
        entryName: "@arkMain",
        entryPathHint: "entry/src/main/ets",
        signature: "@arkMain",
        score: 100,
        status: "ok",
        seedLocalNames: ["want"],
        seedStrategies: ["contract_source"],
        seedCount: 1,
        flowCount: 0,
        flowRuleTraces: [
            {
                source: "source_rule:a",
                sink: "Sink(arg0)",
                sinkRuleId: "sink.target",
                sinkEndpoint: "arg0",
                transferRuleIds: [],
            },
        ],
        sinkRuleHits: { "sink.target": 1 },
        sinkFamilyHits: { "sink.demo.target": 1 },
        sinkEndpointHits: { arg0: 1 },
        sinkFlowByKeyword: {},
        sinkFlowBySignature: {},
        sinkSamples: ["Sink(arg0)"],
        elapsedMs: 1,
    };

    const sourceSummary = createSourceSummary("entry/src/main/ets", [entry], {
        selected: [{
            name: "@arkMain",
            pathHint: "entry/src/main/ets",
            signature: "@arkMain",
            score: 100,
            sourceDir: "entry/src/main/ets",
        }],
        poolTotal: 1,
        filteredTotal: 1,
        poolFileCount: 1,
        filteredFileCount: 1,
        selectedFileCount: 1,
    });

    assert(sourceSummary.withFlows === 1, `expected withFlows=1, got ${sourceSummary.withFlows}`);
    assert(sourceSummary.totalFlows === 1, `expected totalFlows=1, got ${sourceSummary.totalFlows}`);

    const project: ProjectSmokeResult = {
        id: "demo",
        repoPath: "demo",
        tags: [],
        sourceDirs: ["entry/src/main/ets"],
        sourceSummaries: [sourceSummary],
        entries: [entry],
        sinkSignatures: [],
        analyzed: 1,
        withSeeds: 1,
        withFlows: 1,
        totalFlows: 1,
        sinkRuleHits: { "sink.target": 1 },
        sinkFamilyHits: { "sink.demo.target": 1 },
        sinkEndpointHits: { arg0: 1 },
        sinkFlowByKeyword: {},
        sinkFlowBySignature: {},
        fatalErrors: [],
    };

    const options: CliOptions = {
        manifestPath: "tests/manifests/real_projects/smoke_projects.json",
        k: 1,
        maxEntries: 1,
        outputDir: "tmp/test_runs/real_projects/smoke/latest",
    };
    const report = aggregateReport(options, [project]);
    assert(report.totalEntriesWithFlows === 1, `expected totalEntriesWithFlows=1, got ${report.totalEntriesWithFlows}`);
    assert(report.totalFlows === 1, `expected totalFlows=1, got ${report.totalFlows}`);
    assert(report.sinkRuleHits["sink.target"] === 1, "expected report sink.target hit");
    assert(report.sinkFamilyHits["sink.demo.target"] === 1, "expected report family hit");
    assert(report.sinkEndpointHits["arg0"] === 1, "expected report arg0 endpoint hit");

    console.log("====== Sink Inventory Scoring Contract ======");
    console.log(`inventory_flows=${sinkSummary.inventoryFlowCount}`);
    console.log(`target_flows=${sinkSummary.targetFlowCount}`);
    console.log(`spillover_flows=${sinkSummary.spilloverFlowCount}`);
    console.log(`report_sink_rules=${Object.keys(report.sinkRuleHits).length}`);
    console.log("PASS test_sink_inventory_scoring_contract");
}

main().catch(error => {
    console.error("FAIL test_sink_inventory_scoring_contract");
    console.error(error);
    process.exit(1);
});
