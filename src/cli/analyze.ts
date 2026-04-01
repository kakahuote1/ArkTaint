import * as path from "path";
import { parseArgs } from "./analyzeCliOptions";
import { runAnalyze } from "./analyzeRunner";
import { RuleLoadError } from "../core/rules/RuleLoader";
import {
    buildSystemFailureEvent,
    countDiagnosticItems,
    formatDiagnosticsText,
    writeDiagnosticsArtifacts,
} from "./diagnosticsFormat";
import { emptyAnalyzeErrorDiagnostics } from "./analyzeTypes";
import {
    ensureAnalyzeOutputLayout,
    resolveAnalyzeOutputLayout,
    writeAnalyzeFailureRunManifest,
} from "./analyzeOutputLayout";

function resolveFallbackOutputDir(argv: string[]): string {
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--outputDir") {
            const next = argv[i + 1];
            if (next && !next.startsWith("--")) {
                return path.isAbsolute(next) ? next : path.resolve(next);
            }
        }
        if (arg.startsWith("--outputDir=")) {
            const value = arg.slice("--outputDir=".length);
            if (value) {
                return path.isAbsolute(value) ? value : path.resolve(value);
            }
        }
    }
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    return path.resolve("output", "runs", "analyze", "__error__", ts);
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const { report, jsonPath, mdPath, diagnosticsJsonPath, diagnosticsTextPath } = await runAnalyze(options);

    console.log("====== ArkTaint Analyze Summary ======");
    console.log(`repo=${report.repo}`);
    console.log(`source_dirs=${report.sourceDirs.join(",")}`);
    console.log(`report_mode=${report.reportMode}`);
    console.log(`stop_on_first_flow=${options.stopOnFirstFlow}`);
    console.log(`max_flows_per_entry=${options.maxFlowsPerEntry ?? ""}`);
    console.log(`secondary_sink_sweep=${options.enableSecondarySinkSweep}`);
    console.log(`entries=${report.summary.totalEntries}`);
    console.log(`ok_entries=${report.summary.okEntries}`);
    console.log(`with_seeds=${report.summary.withSeeds}`);
    console.log(`with_flows=${report.summary.withFlows}`);
    console.log(`total_flows=${report.summary.totalFlows}`);
    console.log(`status_count=${JSON.stringify(report.summary.statusCount)}`);
    console.log(`rule_hits=${JSON.stringify(report.summary.ruleHits)}`);
    console.log(`rule_hit_endpoints=${JSON.stringify(report.summary.ruleHitEndpoints)}`);
    console.log(`transfer_profile=${JSON.stringify(report.summary.transferProfile)}`);
    console.log(`detect_profile=${JSON.stringify(report.summary.detectProfile)}`);
    console.log(`stage_profile=${JSON.stringify(report.summary.stageProfile)}`);
    console.log(`transfer_no_hit_reasons=${JSON.stringify(report.summary.transferNoHitReasons)}`);
    console.log(`rule_layers=${report.ruleLayers.join(" -> ")}`);
    console.log(`summary_json=${jsonPath}`);
    console.log(`summary_md=${mdPath}`);
    console.log(`diagnostics_txt=${diagnosticsTextPath}`);
    console.log(`diagnostics_json=${diagnosticsJsonPath}`);
    const diagnosticCount = countDiagnosticItems(report.summary.diagnostics);
    if (diagnosticCount > 0) {
        process.stderr.write("\n");
        process.stderr.write(formatDiagnosticsText(report.summary.diagnostics, { maxItems: 3 }));
        console.error(`full_diagnostics_txt=${diagnosticsTextPath}`);
    }
}

main().catch(err => {
    const outputDir = resolveFallbackOutputDir(process.argv.slice(2));
    const outputLayout = resolveAnalyzeOutputLayout(outputDir);
    ensureAnalyzeOutputLayout(outputLayout);
    const diagnostics = emptyAnalyzeErrorDiagnostics();

    if (err instanceof RuleLoadError) {
        diagnostics.ruleLoadIssues = err.issues;
        const { jsonPath, textPath } = writeDiagnosticsArtifacts(outputLayout.diagnosticsDir, diagnostics);
        writeAnalyzeFailureRunManifest(outputLayout, {
            generatedAt: new Date().toISOString(),
        });
        console.error("ArkTaint analyze failed while loading rules.");
        process.stderr.write(formatDiagnosticsText(diagnostics));
        console.error(`diagnostics_txt=${textPath}`);
        console.error(`diagnostics_json=${jsonPath}`);
        process.exitCode = 1;
        return;
    }

    diagnostics.systemFailures.push(buildSystemFailureEvent(err, {
        phase: "analyze",
        code: "SYSTEM_ANALYZE_THROW",
        title: "分析主流程",
        summary: "分析主流程抛出了未归类异常",
        advice: "这不是规则、语义包或插件自身的已归类错误。请先检查这里附近的代码和上一条栈信息，再决定是修配置、扩展还是引擎主流程。",
    }));
    const { jsonPath, textPath } = writeDiagnosticsArtifacts(outputLayout.diagnosticsDir, diagnostics);
    writeAnalyzeFailureRunManifest(outputLayout, {
        generatedAt: new Date().toISOString(),
    });
    console.error("ArkTaint analyze failed.");
    process.stderr.write(formatDiagnosticsText(diagnostics));
    console.error(`diagnostics_txt=${textPath}`);
    console.error(`diagnostics_json=${jsonPath}`);
    console.error(err);
    process.exitCode = 1;
});
