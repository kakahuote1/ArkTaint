import { runKeyedRouteCallbackFixture } from "./KeyedRouteCallbackFixture";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

async function main(): Promise<void> {
    const { baseline, withModule } = runKeyedRouteCallbackFixture({
        testName: "analyze_keyed_route_callback_mismatch_suppressed",
        projectId: "keyed_route_callback_mismatch",
        registerKey: "SafeDetail",
        pushKey: "OtherPage",
        triggerKey: "SafeDetail",
    });
    assert(baseline.summary.totalFlows === 0, `baseline should have zero flows, got ${baseline.summary.totalFlows}`);
    assert(withModule.summary.withSeeds === undefined || withModule.summary.withSeeds > 0, `expected source seed to be collected, got ${withModule.summary.withSeeds}`);
    assert(withModule.summary.totalFlows === 0, `module surviving flows should be zero for mismatched route key, got ${withModule.summary.totalFlows}`);
    const entry = withModule.entries.find(item => item.entryName === "@arkMain") || withModule.entries[0];
    assert(!!entry, "expected one entry result");
    assert((entry.moduleAudit?.failedModuleIds || []).length === 0, `expected no module failures, got ${JSON.stringify(entry.moduleAudit?.failureEvents || [])}`);
    assert((entry.materializedTaintFlows || []).length === 0, "mismatched route key must not materialize a flow");
    console.log("PASS test_analyze_keyed_route_callback_mismatch_suppressed");
    console.log(`baseline_total_flows=${baseline.summary.totalFlows}`);
    console.log(`module_total_flows=${withModule.summary.totalFlows}`);
}

main().catch((error) => {
    console.error("FAIL test_analyze_keyed_route_callback_mismatch_suppressed");
    console.error(error);
    process.exit(1);
});
