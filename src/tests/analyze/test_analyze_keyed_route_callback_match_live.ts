import { runKeyedRouteCallbackFixture } from "./KeyedRouteCallbackFixture";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

async function main(): Promise<void> {
    const { baseline, withModule } = runKeyedRouteCallbackFixture({
        testName: "analyze_keyed_route_callback_match_live",
        projectId: "keyed_route_callback_match",
        registerKey: "Detail",
        pushKey: "Detail",
        triggerKey: "Detail",
    });
    assert(baseline.summary.totalFlows === 0, `baseline should have zero flows, got ${baseline.summary.totalFlows}`);
    assert(withModule.summary.withSeeds === undefined || withModule.summary.withSeeds > 0, `expected source seed to be collected, got ${withModule.summary.withSeeds}`);
    assert(withModule.summary.totalFlows > 0, `module run should produce flows, got ${withModule.summary.totalFlows}`);
    const entry = withModule.entries.find(item => item.entryName === "@arkMain") || withModule.entries[0];
    assert(!!entry, "expected one entry result");
    assert((entry.moduleAudit?.failedModuleIds || []).length === 0, `expected no module failures, got ${JSON.stringify(entry.moduleAudit?.failureEvents || [])}`);
    const materialized = entry.materializedTaintFlows || [];
    assert(materialized.length > 0, "expected surviving materializedTaintFlows");
    const judgements = materialized.flatMap(flow => (flow.paths || []).map(pathItem => pathItem.judgement || flow.judgement || ""));
    assert(judgements.some(kind => kind === "Confirmed"), `expected one Confirmed live route flow, got ${JSON.stringify(judgements)}`);
    console.log("PASS test_analyze_keyed_route_callback_match_live");
    console.log(`baseline_total_flows=${baseline.summary.totalFlows}`);
    console.log(`module_total_flows=${withModule.summary.totalFlows}`);
}

main().catch((error) => {
    console.error("FAIL test_analyze_keyed_route_callback_match_live");
    console.error(error);
    process.exit(1);
});
