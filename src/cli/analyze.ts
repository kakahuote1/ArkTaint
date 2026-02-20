import { parseArgs } from "./analyzeCliOptions";
import { runAnalyze } from "./analyzeRunner";

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const { report, jsonPath, mdPath } = await runAnalyze(options);

    console.log("====== ArkTaint Analyze Summary ======");
    console.log(`repo=${report.repo}`);
    console.log(`source_dirs=${report.sourceDirs.join(",")}`);
    console.log(`report_mode=${report.reportMode}`);
    console.log(`entries=${report.summary.totalEntries}`);
    console.log(`ok_entries=${report.summary.okEntries}`);
    console.log(`with_seeds=${report.summary.withSeeds}`);
    console.log(`with_flows=${report.summary.withFlows}`);
    console.log(`total_flows=${report.summary.totalFlows}`);
    console.log(`status_count=${JSON.stringify(report.summary.statusCount)}`);
    console.log(`rule_hits=${JSON.stringify(report.summary.ruleHits)}`);
    console.log(`rule_hit_endpoints=${JSON.stringify(report.summary.ruleHitEndpoints)}`);
    console.log(`transfer_profile=${JSON.stringify(report.summary.transferProfile)}`);
    console.log(`stage_profile=${JSON.stringify(report.summary.stageProfile)}`);
    console.log(`transfer_no_hit_reasons=${JSON.stringify(report.summary.transferNoHitReasons)}`);
    console.log(`rule_layers=${report.ruleLayers.join(" -> ")}`);
    console.log(`summary_json=${jsonPath}`);
    console.log(`summary_md=${mdPath}`);
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
