import * as fs from "fs";
import * as path from "path";
import { parseArgs } from "./analyzeCliOptions";
import { runAnalyze } from "./analyzeRunner";
import { RuleLoadError } from "../core/rules/RuleLoader";
import { inspectModules, ModuleCatalogEntry } from "../core/orchestration/modules/ModuleLoader";
import { EnginePluginCatalogEntry, inspectEnginePlugins } from "../core/orchestration/plugins/EnginePluginLoader";
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

function formatModuleSource(entry: ModuleCatalogEntry): string {
    if (entry.source === "project_module") {
        return entry.projectId ? `project:${entry.projectId}` : "project";
    }
    if (entry.source === "builtin_kernel") return "kernel";
    if (entry.source === "explicit_file") return "explicit_file";
    if (entry.source === "explicit_spec_file") return "explicit_spec_file";
    if (entry.source === "explicit_spec") return "explicit_spec";
    return "explicit_object";
}

function renderModuleProjectInspection(
    discoveredProjects: string[],
    enabledProjects: string[],
): string {
    const enabledSet = new Set(enabledProjects);
    const lines = [
        "====== ArkTaint Module Projects ======",
        `discovered=${discoveredProjects.length}`,
        `enabled=${enabledProjects.length}`,
    ];
    for (const projectId of discoveredProjects) {
        lines.push(`project=${projectId}\tenabled=${enabledSet.has(projectId)}`);
    }
    return `${lines.join("\n")}\n`;
}

function renderModuleCatalog(catalog: ModuleCatalogEntry[]): string {
    const lines = [
        "====== ArkTaint Modules ======",
        `modules=${catalog.length}`,
    ];
    for (const entry of catalog) {
        lines.push(
            `module=${entry.id}\tstatus=${entry.effectiveStatus}\tsource=${formatModuleSource(entry)}\tpath=${entry.sourcePath || ""}`,
        );
    }
    return `${lines.join("\n")}\n`;
}

function renderModuleExplanation(entry: ModuleCatalogEntry): string {
    return [
        "====== ArkTaint Module Explain ======",
        `module=${entry.id}`,
        `description=${entry.description}`,
        `status=${entry.effectiveStatus}`,
        `source=${formatModuleSource(entry)}`,
        `project=${entry.projectId || ""}`,
        `file_enabled=${entry.enabledByFile}`,
        `path=${entry.sourcePath || ""}`,
    ].join("\n");
}

function renderModuleTrace(report: Awaited<ReturnType<typeof runAnalyze>>["report"], moduleId: string): string {
    const summary = report.summary.moduleAudit;
    const stats = summary.modules[moduleId];
    const lines = [
        "====== ArkTaint Module Trace ======",
        `module=${moduleId}`,
        `loaded=${summary.loadedModuleIds.includes(moduleId)}`,
        `failed=${summary.failedModuleIds.includes(moduleId)}`,
    ];
    if (!stats) {
        lines.push("status=not_observed");
        return `${lines.join("\n")}\n`;
    }
    lines.push(`path=${stats.sourcePath || ""}`);
    lines.push(`fact_hook_calls=${stats.factHookCalls}`);
    lines.push(`invoke_hook_calls=${stats.invokeHookCalls}`);
    lines.push(`copy_edge_checks=${stats.copyEdgeChecks}`);
    lines.push(`fact_emissions=${stats.factEmissionCount}`);
    lines.push(`invoke_emissions=${stats.invokeEmissionCount}`);
    lines.push(`total_emissions=${stats.totalEmissionCount}`);
    lines.push(`skip_copy_edge_hits=${stats.skipCopyEdgeCount}`);
    lines.push(`debug_hits=${stats.debugHitCount}`);
    lines.push(`debug_skips=${stats.debugSkipCount}`);
    lines.push(`debug_logs=${stats.debugLogCount}`);
    lines.push(`recent_debug_messages=${JSON.stringify(stats.recentDebugMessages)}`);
    return `${lines.join("\n")}\n`;
}

function formatPluginSource(entry: EnginePluginCatalogEntry): string {
    if (entry.source === "builtin") return "builtin";
    if (entry.source === "external") return "external";
    return "explicit";
}

function renderPluginCatalog(catalog: EnginePluginCatalogEntry[]): string {
    const lines = [
        "====== ArkTaint Plugins ======",
        `plugins=${catalog.length}`,
    ];
    for (const entry of catalog) {
        lines.push(
            `plugin=${entry.name}\tstatus=${entry.effectiveStatus}\tsource=${formatPluginSource(entry)}\tpath=${entry.sourcePath || ""}`,
        );
    }
    return `${lines.join("\n")}\n`;
}

function renderPluginExplanation(entry: EnginePluginCatalogEntry): string {
    return [
        "====== ArkTaint Plugin Explain ======",
        `plugin=${entry.name}`,
        `description=${entry.description || ""}`,
        `status=${entry.effectiveStatus}`,
        `source=${formatPluginSource(entry)}`,
        `file_enabled=${entry.enabledByFile}`,
        `path=${entry.sourcePath || ""}`,
    ].join("\n");
}

function renderPluginTrace(report: Awaited<ReturnType<typeof runAnalyze>>["report"], pluginName: string): string {
    const summary = report.summary.pluginAudit;
    const stats = summary.plugins[pluginName];
    const lines = [
        "====== ArkTaint Plugin Trace ======",
        `plugin=${pluginName}`,
        `loaded=${summary.loadedPluginNames.includes(pluginName)}`,
        `failed=${summary.failedPluginNames.includes(pluginName)}`,
    ];
    if (!stats) {
        lines.push("status=not_observed");
        return `${lines.join("\n")}\n`;
    }
    lines.push(`path=${stats.sourcePath || ""}`);
    lines.push(`description=${stats.description || ""}`);
    lines.push(`start_hook_calls=${stats.startHookCalls}`);
    lines.push(`entry_hook_calls=${stats.entryHookCalls}`);
    lines.push(`propagation_hook_calls=${stats.propagationHookCalls}`);
    lines.push(`detection_hook_calls=${stats.detectionHookCalls}`);
    lines.push(`result_hook_calls=${stats.resultHookCalls}`);
    lines.push(`finish_hook_calls=${stats.finishHookCalls}`);
    lines.push(`source_rules_added=${stats.sourceRulesAdded}`);
    lines.push(`sink_rules_added=${stats.sinkRulesAdded}`);
    lines.push(`transfer_rules_added=${stats.transferRulesAdded}`);
    lines.push(`sanitizer_rules_added=${stats.sanitizerRulesAdded}`);
    lines.push(`option_overrides=${stats.optionOverrideCount}`);
    lines.push(`entry_adds=${stats.entryAdds}`);
    lines.push(`entry_replace_used=${stats.entryReplaceUsed}`);
    lines.push(`call_edge_observers=${stats.callEdgeObserverCount}`);
    lines.push(`taint_flow_observers=${stats.taintFlowObserverCount}`);
    lines.push(`method_reached_observers=${stats.methodReachedObserverCount}`);
    lines.push(`propagation_replace_used=${stats.propagationReplaceUsed}`);
    lines.push(`added_flows=${stats.addedFlowCount}`);
    lines.push(`added_bridges=${stats.addedBridgeCount}`);
    lines.push(`added_synthetic_edges=${stats.addedSyntheticEdgeCount}`);
    lines.push(`enqueued_facts=${stats.enqueuedFactCount}`);
    lines.push(`detection_checks=${JSON.stringify(stats.detectionCheckNames)}`);
    lines.push(`detection_check_runs=${stats.detectionCheckRunCount}`);
    lines.push(`detection_replace_used=${stats.detectionReplaceUsed}`);
    lines.push(`result_filters=${stats.resultFilterCount}`);
    lines.push(`result_transforms=${stats.resultTransformCount}`);
    lines.push(`result_added_findings=${stats.resultAddedFindingCount}`);
    return `${lines.join("\n")}\n`;
}

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
    if (options.listModules || options.listModuleProjects || options.explainModuleId) {
        const inspection = inspectModules({
            moduleRoots: options.moduleRoots || [],
            moduleSpecFiles: options.moduleSpecFiles || [],
            enabledModuleProjects: options.enabledModuleProjects || [],
            disabledModuleProjects: options.disabledModuleProjects || [],
            disabledModuleIds: options.disabledModuleIds || [],
            includeBuiltinModules: true,
        });
        if (options.listModuleProjects) {
            process.stdout.write(renderModuleProjectInspection(
                inspection.discoveredModuleProjects,
                inspection.enabledModuleProjects,
            ));
            return;
        }
        if (options.listModules) {
            process.stdout.write(renderModuleCatalog(inspection.catalog));
            return;
        }
        if (options.explainModuleId) {
            const matches = inspection.catalog.filter(entry => entry.id === options.explainModuleId);
            if (matches.length === 0) {
                throw new Error(`module not found: ${options.explainModuleId}`);
            }
            process.stdout.write(`${matches.map(renderModuleExplanation).join("\n\n")}\n`);
            return;
        }
    }
    if (options.listPlugins || options.explainPluginName) {
        const pluginDirs = (options.pluginPaths || []).filter(p => fs.existsSync(p) && fs.statSync(p).isDirectory());
        const pluginFiles = (options.pluginPaths || []).filter(p => fs.existsSync(p) && fs.statSync(p).isFile());
        const pluginInspection = inspectEnginePlugins({
            pluginDirs,
            pluginFiles,
            disabledPluginNames: options.disabledPluginNames || [],
            isolatePluginNames: options.pluginIsolate || [],
            includeBuiltinPlugins: true,
        });
        if (options.listPlugins) {
            process.stdout.write(renderPluginCatalog(pluginInspection.catalog));
            return;
        }
        if (options.explainPluginName) {
            const matches = pluginInspection.catalog.filter(entry => entry.name === options.explainPluginName);
            if (matches.length === 0) {
                throw new Error(`plugin not found: ${options.explainPluginName}`);
            }
            process.stdout.write(`${matches.map(renderPluginExplanation).join("\n\n")}\n`);
            return;
        }
    }
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
    if (options.traceModuleId) {
        process.stdout.write(`\n${renderModuleTrace(report, options.traceModuleId)}`);
    }
    if (options.tracePluginName) {
        process.stdout.write(`\n${renderPluginTrace(report, options.tracePluginName)}`);
    }
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
