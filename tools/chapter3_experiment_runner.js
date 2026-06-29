#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = process.cwd();
const DEFAULT_OUTPUT_ROOT = path.join("tmp", "test_runs", "chapter3");
const DEFAULT_INVENTORY = path.join("tmp", "repo_metrics_experiment", "real_project_inventory.repo_ranked.full.arkts_nondemo.content_filtered.csv");
const DEFAULT_AUDIT_ROOT = path.join("internal_docs", "security_asset_iteration", "audits");
const DEFAULT_PROJECT_ROOT = fs.existsSync("D:\\cursor\\workplace\\project")
  ? "D:\\cursor\\workplace\\project"
  : path.resolve("..", "project");
const CONFIG_DIR = path.join("experiments", "chapter3", "configs");
const CORE_CONFIGS = ["No1_base", "No2_base_ude", "No3_base_oclfs", "No4_full_engine"];
const SCALE_CONFIG = "No5_real_scale_full";
const FIELD_NAME = "\u540d\u79f0";
const FIELD_SOURCE_URL = "\u6765\u6e90\u5730\u5740";
const FIELD_DESCRIPTION = "\u8bf4\u660e";
const COMPREHENSIVE_BENCHMARK = {
  benchmark_id: "arktaint-bench",
  benchmark_name: "ArkTaint Comprehensive Benchmark",
  script: "test:arktaint-bench",
  manifest: path.join("tests", "manifests", "benchmarks", "arktaint_bench.json"),
  purpose: "Run the single integrated benchmark assembled from the HapFlow-derived HapBench corpus and ArkTaint-owned benchmark cases.",
};
const MECHANISM_TESTS = [
  { group: "UDE", mechanism: "contract", script: "test:execution-handoff-contract" },
  { group: "UDE", mechanism: "audit", script: "test:execution-handoff-audit" },
  { group: "UDE", mechanism: "proof", script: "test:execution-handoff-proof" },
  { group: "UDE", mechanism: "coverage", script: "test:execution-handoff-coverage" },
  { group: "UDE", mechanism: "necessity", script: "test:execution-handoff-necessity" },
  { group: "UDE", mechanism: "semantic-core", script: "test:execution-handoff-semantic-core" },
  { group: "UDE", mechanism: "semantic-algorithm", script: "test:execution-handoff-semantic-algorithm" },
  { group: "UDE", mechanism: "declarative-binding", script: "test:execution-handoff-declarative-binding" },
  { group: "UDE", mechanism: "module-declared-binding", script: "test:execution-handoff-module-declared-binding" },
  { group: "UDE", mechanism: "boundaries", script: "test:execution-handoff-boundaries" },
  { group: "UDE", mechanism: "inference", script: "test:execution-handoff-inference" },
  { group: "UDE", mechanism: "env-ports", script: "test:execution-handoff-env-ports" },
  { group: "UDE", mechanism: "unification-audit", script: "test:execution-handoff-unification-audit" },
  { group: "UDE", mechanism: "unification-semantic-audit", script: "test:execution-handoff-unification-semantic-audit" },
  { group: "UDE", mechanism: "ablation", script: "test:execution-handoff-ablation" },
  { group: "OCLFS", mechanism: "certificate", script: "test:algorithm-e-oclfs" },
  { group: "OCLFS", mechanism: "handoff-currentness", script: "test:handoff-sensitive-propagation" },
  { group: "OCLFS", mechanism: "safe-overwrite", script: "test:analyze-safe-overwrite-suppressed" },
  { group: "OCLFS", mechanism: "delete-before-read", script: "test:analyze-delete-before-read-refinement" },
  { group: "OCLFS", mechanism: "partial-path-survival", script: "test:analyze-safe-overwrite-partial-path-survival" },
  { group: "OCLFS", mechanism: "keyed-route-mismatch", script: "test:analyze-keyed-route-callback-mismatch-suppressed" },
  { group: "OCLFS", mechanism: "keyed-route-match-live", script: "test:analyze-keyed-route-callback-match-live" },
  { group: "OCLFS", mechanism: "appstorage-statecell", script: "test:harmony-appstorage" },
  { group: "OCLFS", mechanism: "state-slot-currentness", script: "test:harmony-state" },
  { group: "FIELD", mechanism: "field-sensitive-core", script: "test:field-sensitive-core" },
  { group: "FIELD", mechanism: "object-path-matrix", script: "test:object-path-matrix" },
  { group: "FIELD", mechanism: "object-update-precision", script: "test:object-update-precision" },
  { group: "FIELD", mechanism: "object-container-bridge", script: "test:object-container-bridge" },
  { group: "FIELD", mechanism: "array-precision", script: "test:array-precision-matrix" },
  { group: "FIELD", mechanism: "container-model", script: "test:container-model-precision" },
  { group: "FIELD", mechanism: "result-container", script: "test:result-container-precision" },
  { group: "FIELD", mechanism: "container-invalidation", script: "test:object-container-invalidation" },
  { group: "FIELD", mechanism: "sibling-field-negative", script: "test:analyze-object-container-sibling-field-precision" },
  { group: "FIELD", mechanism: "returned-object-field", script: "test:analyze-returned-object-field" },
  { group: "OFFICIAL_ASSET", mechanism: "coverage-ledger", script: "test:official-api-coverage-gate" },
  { group: "OFFICIAL_ASSET", mechanism: "precision-gate", script: "test:official-semantics-precision-gate" },
  { group: "OFFICIAL_ASSET", mechanism: "kernel-governance", script: "test:kernel-official-asset-governance" },
  { group: "OFFICIAL_ASSET", mechanism: "structured-transfer", script: "test:official-structured-transfer-assets" },
  { group: "OFFICIAL_ASSET", mechanism: "module-slots", script: "test:official-module-semantic-slots" },
  { group: "OFFICIAL_ASSET", mechanism: "form-ui", script: "test:official-form-ui-asset-coverage" },
  { group: "OFFICIAL_ASSET", mechanism: "kv-picker", script: "test:official-kv-picker-asset-coverage" },
  { group: "OFFICIAL_ASSET", mechanism: "source-exact", script: "test:source-exact" },
  { group: "OFFICIAL_ASSET", mechanism: "sink-exact", script: "test:sink-exact" },
  { group: "OFFICIAL_ASSET", mechanism: "transfer-exact", script: "test:transfer-exact" },
  { group: "OFFICIAL_ASSET", mechanism: "sanitizer-guard", script: "test:sanitizer-guard" },
];

function main() {
  const { command, opts } = parseCli(process.argv.slice(2));
  if (!command || command === "help" || opts.help) {
    printHelp();
    return;
  }
  if (command === "manifest") return cmdManifest(opts);
  if (command === "unit") return cmdUnit(opts);
  if (command === "benchmark") return cmdBenchmark(opts);
  if (command === "benchmark-report") return cmdBenchmarkReport(opts);
  if (command === "audit-compare") return cmdAuditCompare(opts);
  if (command === "real-core") return cmdRealCore(opts);
  if (command === "real-scale") return cmdRealScale(opts);
  if (command === "summarize") return cmdSummarize(opts);
  if (command === "all-smoke") return cmdAllSmoke(opts);
  throw new Error(`unknown command: ${command}`);
}

function parseCli(argv) {
  const opts = {};
  let command = "";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--") && !command) {
      command = arg;
      continue;
    }
    const readValue = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`missing value for ${arg}`);
      return value;
    };
    if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--runId") opts.runId = readValue();
    else if (arg === "--outputRoot") opts.outputRoot = readValue();
    else if (arg === "--inventory") opts.inventory = readValue();
    else if (arg === "--projectRoot") opts.projectRoot = readValue();
    else if (arg === "--manifest") opts.manifest = readValue();
    else if (arg === "--auditRoot") opts.auditRoot = readValue();
    else if (arg === "--maxProjects") opts.maxProjects = Number(readValue());
    else if (arg === "--realCoreProjects") opts.realCoreProjects = Number(readValue());
    else if (arg === "--caseStudyProjects") opts.caseStudyProjects = Number(readValue());
    else if (arg === "--projectTimeoutSeconds") opts.projectTimeoutSeconds = Number(readValue());
    else if (arg === "--maxEntries") opts.maxEntries = Number(readValue());
    else if (arg === "--maxKloc") opts.maxKloc = Number(readValue());
    else if (arg === "--config") opts.config = readValue();
    else if (arg === "--unitSmoke") opts.unitSmoke = true;
    else if (arg === "--unitGroup") opts.unitGroup = readValue();
    else if (arg === "--skipExisting") opts.skipExisting = true;
    else if (arg === "--autoModel") opts.autoModel = true;
    else if (arg === "--llmProfile") opts.llmProfile = readValue();
    else if (arg === "--model") opts.model = readValue();
    else if (arg === "--maxLlmItems") opts.maxLlmItems = Number(readValue());
    else if (arg === "--concurrency") opts.concurrency = Number(readValue());
    else throw new Error(`unknown option: ${arg}`);
  }
  return { command, opts };
}

function printHelp() {
  console.log([
    "Usage: node tools/chapter3_experiment_runner.js <command> [options]",
    "",
    "Commands:",
    "  manifest       Generate test_manifest.csv and experiment_manifest.json",
    "  unit           Run Chapter 3 UDE/OCLFS unit checks and write CSV results",
    "  benchmark      Run the single integrated ArkTaint benchmark test set",
    "  benchmark-report Parse the latest integrated benchmark report without rerunning it",
    "  audit-compare  Compare manually audited real-project flow ledgers with engine outputs",
    "  real-core      Run No.1-No.4 on the Real-Core project subset",
    "  real-scale     Run No.5 on the full filtered project set",
    "  summarize      Generate Chapter 3 summary and diff tables",
    "  all-smoke      Manifest + unit smoke + one-project No.1/No.4 run + summary",
    "",
    "Common options:",
    "  --runId <id>",
    "  --maxProjects <n>",
    "  --realCoreProjects <n>",
    "  --projectTimeoutSeconds <n>",
    "  --maxEntries <n>",
    "  --maxKloc <n>",
    "  --config <No1_base,No4_full_engine>",
    "  --unitGroup <UDE,OCLFS,FIELD,OFFICIAL_ASSET>",
    "  --auditRoot <path>",
  ].join("\n"));
}

function cmdManifest(opts) {
  const ctx = createRunContext(opts);
  ensureDir(ctx.runDir);
  const rows = buildManifestRows(ctx, {
    maxProjects: numberOr(opts.maxProjects, 0),
    realCoreProjects: numberOr(opts.realCoreProjects, 50),
    caseStudyProjects: numberOr(opts.caseStudyProjects, 8),
    maxKloc: numberOr(opts.maxKloc, 0),
  });
  writeCsv(ctx.manifestPath, rows);
  writeExperimentManifest(ctx, rows);
  writeJson(path.join(ctx.runDir, "manifest_summary.json"), summarizeManifest(rows));
  console.log(`manifest_written ${ctx.manifestPath} rows=${rows.length}`);
}

function cmdUnit(opts) {
  const ctx = createRunContext(opts);
  ensureRunBase(ctx);
  assertBuilt();
  const unitDir = path.join(ctx.runDir, "unit");
  ensureDir(unitDir);
  const selectedTests = selectMechanismTests(opts);
  writeCsv(path.join(ctx.runDir, "mechanism_test_manifest.csv"), selectedTests.map((test, index) => ({
    test_index: index + 1,
    group: test.group,
    mechanism: test.mechanism,
    script: test.script,
  })));
  const rows = [];
  for (let i = 0; i < selectedTests.length; i++) {
    const test = selectedTests[i];
    console.log(`mechanism_test_start ${i + 1}/${selectedTests.length} ${test.group}/${test.mechanism} ${test.script}`);
    rows.push(runNpmUnit(ctx, unitDir, test));
    writeCsv(path.join(ctx.runDir, "mechanism_unit_results.csv"), rows);
    writeJson(path.join(ctx.runDir, "mechanism_progress.json"), summarizeMechanismProgress(selectedTests, rows));
    console.log(`mechanism_test_done ${i + 1}/${selectedTests.length} ${test.group}/${test.mechanism} status=${rows[rows.length - 1].status}`);
  }
  for (const group of [...new Set(rows.map(row => row.group))]) {
    writeCsv(path.join(ctx.runDir, `${safeName(group.toLowerCase())}_unit_results.csv`), rows.filter(row => row.group === group));
  }
  writeJson(path.join(ctx.runDir, "mechanism_summary.json"), summarizeMechanismProgress(selectedTests, rows));
  console.log(`unit_results_written ${ctx.runDir} tests=${rows.length}`);
}

function cmdBenchmark(opts) {
  const ctx = createRunContext(opts);
  ensureRunBase(ctx);
  assertBuilt();
  const benchmarkDir = path.join(ctx.runDir, "benchmark");
  ensureDir(benchmarkDir);
  writeCsv(path.join(ctx.runDir, "benchmark_test_manifest.csv"), [{
    benchmark_id: COMPREHENSIVE_BENCHMARK.benchmark_id,
    benchmark_name: COMPREHENSIVE_BENCHMARK.benchmark_name,
    script: COMPREHENSIVE_BENCHMARK.script,
    manifest: COMPREHENSIVE_BENCHMARK.manifest,
    purpose: COMPREHENSIVE_BENCHMARK.purpose,
  }]);
  const logPath = path.join(benchmarkDir, `${safeName(COMPREHENSIVE_BENCHMARK.script)}.log`);
  const started = Date.now();
  console.log(`benchmark_start ${COMPREHENSIVE_BENCHMARK.benchmark_id} ${COMPREHENSIVE_BENCHMARK.script}`);
  const result = runCommand(ctx, npmCommand(), ["run", COMPREHENSIVE_BENCHMARK.script], logPath, { cwd: ROOT });
  const row = {
    benchmark_id: COMPREHENSIVE_BENCHMARK.benchmark_id,
    benchmark_name: COMPREHENSIVE_BENCHMARK.benchmark_name,
    script: COMPREHENSIVE_BENCHMARK.script,
    status: result.status,
    exitCode: result.exitCode,
    elapsedMs: Date.now() - started,
    logPath,
  };
  writeCsv(path.join(ctx.runDir, "benchmark_results.csv"), [row]);
  const parsedReport = row.exitCode === 0 ? parseLatestBenchmarkReport() : null;
  if (parsedReport) {
    writeCsv(path.join(ctx.runDir, "benchmark_failure_details.csv"), parsedReport.failureRows);
    writeCsv(path.join(ctx.runDir, "benchmark_section_summary.csv"), parsedReport.sectionRows);
    writeJson(path.join(ctx.runDir, "benchmark_failure_summary.json"), parsedReport.summary);
  }
  if (row.exitCode !== 0) {
    writeJson(path.join(ctx.runDir, "benchmark_failure_verdict.json"), {
      status: "failed_before_current_report_generated",
      reason: "benchmark command exited non-zero; stale latest/report.json was not parsed",
      benchmark: COMPREHENSIVE_BENCHMARK,
      exitCode: row.exitCode,
      elapsedMs: row.elapsedMs,
      logPath,
      updatedAt: new Date().toISOString(),
    });
  }
  writeJson(path.join(ctx.runDir, "benchmark_summary.json"), {
    benchmark: COMPREHENSIVE_BENCHMARK,
    status: row.status,
    exitCode: row.exitCode,
    elapsedMs: row.elapsedMs,
    logPath,
    staleReportParsingSkipped: row.exitCode !== 0,
    parsedReport: parsedReport ? {
      reportPath: parsedReport.reportPath,
      failureDetails: path.join(ctx.runDir, "benchmark_failure_details.csv"),
      sectionSummary: path.join(ctx.runDir, "benchmark_section_summary.csv"),
      failureSummary: path.join(ctx.runDir, "benchmark_failure_summary.json"),
    } : null,
    updatedAt: new Date().toISOString(),
  });
  console.log(`benchmark_done ${COMPREHENSIVE_BENCHMARK.benchmark_id} status=${row.status}`);
}

function cmdBenchmarkReport(opts) {
  const ctx = createRunContext(opts);
  ensureDir(ctx.runDir);
  const parsedReport = parseLatestBenchmarkReport();
  if (!parsedReport) throw new Error("benchmark report not found; run npm run chapter3:benchmark first");
  writeCsv(path.join(ctx.runDir, "benchmark_failure_details.csv"), parsedReport.failureRows);
  writeCsv(path.join(ctx.runDir, "benchmark_section_summary.csv"), parsedReport.sectionRows);
  writeJson(path.join(ctx.runDir, "benchmark_failure_summary.json"), parsedReport.summary);
  console.log(`benchmark_report_written ${ctx.runDir} failures=${parsedReport.failureRows.length}`);
}

function parseLatestBenchmarkReport() {
  const reportPath = path.join(ROOT, "tmp", "test_runs", "benchmark", "arktaint_bench", "latest", "report.json");
  const report = readJsonSafe(reportPath);
  if (!report) return null;
  const sections = [
    ["seniorFull", report.seniorFull],
    ["seniorFullBoundary", report.seniorFullBoundary],
    ["seniorFullObservationOnly", report.seniorFullObservationOnly],
    ["hapBench", report.hapBench],
  ];
  const sectionRows = [];
  const failureRows = [];
  for (const [section, summary] of sections) {
    if (!summary) continue;
    const failures = Array.isArray(summary.failures)
      ? summary.failures
      : Array.isArray(summary.mismatches)
        ? summary.mismatches
        : [];
    sectionRows.push({
      section,
      total: summary.total,
      positives: summary.positives,
      negatives: summary.negatives,
      tp: summary.tp,
      tn: summary.tn,
      fp: summary.fp,
      fn: summary.fn,
      failures: failures.length,
    });
    for (const failure of failures) {
      failureRows.push({
        section,
        caseKey: failure.caseKey || failure.case || failure.name || "",
        category: failure.category || "",
        expectedFlow: boolText(failure.expectedFlow),
        detectedFlow: boolText(failure.detectedFlow),
        flowCount: failure.flowCount === undefined ? "" : failure.flowCount,
        inventoryFlowCount: failure.inventoryFlowCount === undefined ? "" : failure.inventoryFlowCount,
        boundary: boolText(failure.boundary),
        observationOnly: boolText(failure.observationOnly),
      });
    }
  }
  const bySection = countBy(failureRows, row => row.section || "unknown");
  const byCategory = countBy(failureRows, row => row.category || "unknown");
  return {
    reportPath,
    sectionRows,
    failureRows,
    summary: {
      generatedAt: new Date().toISOString(),
      reportPath,
      total: report.total || null,
      sections: sectionRows,
      failureCount: failureRows.length,
      failuresBySection: bySection,
      failuresByCategory: byCategory,
    },
  };
}

function cmdAuditCompare(opts) {
  const ctx = createRunContext(opts);
  ensureDir(ctx.runDir);
  const auditRoot = path.resolve(opts.auditRoot || DEFAULT_AUDIT_ROOT);
  if (!fs.existsSync(auditRoot)) throw new Error(`audit root not found: ${auditRoot}`);
  const outDir = path.join(ctx.runDir, "audit_compare");
  ensureDir(outDir);
  const projects = fs.readdirSync(auditRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
  const projectRows = [];
  const flowRows = [];
  const classRows = [];
  for (const projectId of projects) {
    const projectDir = path.join(auditRoot, projectId);
    const ledgerPath = path.join(projectDir, "full_taint_flow_reaudit.md");
    const finalReportPath = path.join(projectDir, "final_report.md");
    const enginePath = path.join(projectDir, "engine_flows.json");
    const flows = fs.existsSync(ledgerPath) ? parseManualFlowLedger(ledgerPath, projectId) : [];
    for (const flow of flows) flowRows.push(flow);
    const classCounts = countBy(flows, flow => flow.classification || "unknown");
    for (const [classification, count] of Object.entries(classCounts).sort()) {
      classRows.push({ project_id: projectId, classification, count });
    }
    const engine = readJsonSafe(enginePath) || {};
    const manualDiff = engine.manual_diff || {};
    const engineFlowCount = toNumber(engine.engine_flow_count ?? engine.summary?.total_flows ?? engine.summary?.totalFlows);
    const vulnerabilityCount = countFlowsByPrefix(flows, "vulnerability_flow");
    const ordinaryCount = countFlowsByPrefix(flows, "ordinary_valid_taint_flow");
    const normalBusinessCount = countFlowsByPrefix(flows, "normal_business_flow");
    const hardeningCount = countFlowsByPrefix(flows, "hardening_observation");
    const partialCount = countFlowsByPrefix(flows, "partial_flow");
    const excludedCount = countFlowsByPrefix(flows, "excluded");
    projectRows.push({
      project_id: projectId,
      audit_dir: projectDir,
      has_full_taint_flow_reaudit: fs.existsSync(ledgerPath) ? "yes" : "no",
      has_final_report: fs.existsSync(finalReportPath) ? "yes" : "no",
      has_engine_flows: fs.existsSync(enginePath) ? "yes" : "no",
      manual_flow_count: flows.length,
      vulnerability_flow_count: vulnerabilityCount,
      ordinary_valid_flow_count: ordinaryCount,
      normal_business_flow_count: normalBusinessCount,
      hardening_observation_count: hardeningCount,
      partial_flow_count: partialCount,
      excluded_flow_count: excludedCount,
      engine_mode: engine.engine_mode || "",
      engine_status: engine.status || "",
      engine_flow_count: engineFlowCount,
      engine_source_hit_count: sum(Object.values(engine.source_hits || {}).map(toNumber)),
      engine_sink_hit_count: sum(Object.values(engine.sink_hits || {}).map(toNumber)),
      manual_diff_manual_flow_count: toNumber(manualDiff.manual_flow_count),
      manual_diff_missed_count: toNumber(manualDiff.missed_count),
      manual_diff_false_positive_count: toNumber(manualDiff.false_positive_count),
      manual_diff_duplicate_count: toNumber(manualDiff.duplicate_count),
      manual_diff_unresolved_count: toNumber(manualDiff.unresolved_count),
      audit_engine_gap: classifyAuditEngineGap(flows.length, engineFlowCount, fs.existsSync(enginePath)),
      diff_reason: manualDiff.reason || "",
    });
  }
  writeCsv(path.join(outDir, "audit_project_comparison.csv"), projectRows);
  writeCsv(path.join(outDir, "manual_flow_ledger.csv"), flowRows);
  writeCsv(path.join(outDir, "manual_flow_class_counts.csv"), classRows);
  writeJson(path.join(outDir, "audit_compare_summary.json"), summarizeAuditCompare(projectRows, flowRows));
  writeJson(path.join(outDir, "audit_compare_manifest.json"), {
    runId: ctx.runId,
    auditRoot,
    projectCount: projects.length,
    generatedAt: new Date().toISOString(),
    outputs: {
      projectComparison: path.join(outDir, "audit_project_comparison.csv"),
      manualFlowLedger: path.join(outDir, "manual_flow_ledger.csv"),
      classCounts: path.join(outDir, "manual_flow_class_counts.csv"),
      summary: path.join(outDir, "audit_compare_summary.json"),
    },
  });
  console.log(`audit_compare_written ${outDir} projects=${projectRows.length} flows=${flowRows.length}`);
}

function selectMechanismTests(opts) {
  const wanted = new Set(String(opts.unitGroup || "")
    .split(",")
    .map(item => item.trim().toUpperCase())
    .filter(Boolean));
  let tests = wanted.size > 0
    ? MECHANISM_TESTS.filter(test => wanted.has(test.group))
    : MECHANISM_TESTS;
  if (opts.unitSmoke) {
    const seen = new Set();
    tests = tests.filter(test => {
      if (seen.has(test.group)) return false;
      seen.add(test.group);
      return true;
    });
  }
  if (tests.length === 0) throw new Error(`no mechanism tests selected for unitGroup=${opts.unitGroup || ""}`);
  return tests;
}

function summarizeMechanismProgress(tests, rows) {
  const byGroup = {};
  for (const test of tests) {
    byGroup[test.group] = byGroup[test.group] || { group: test.group, planned: 0, completed: 0, passed: 0, failed: 0 };
    byGroup[test.group].planned++;
  }
  for (const row of rows) {
    byGroup[row.group] = byGroup[row.group] || { group: row.group, planned: 0, completed: 0, passed: 0, failed: 0 };
    byGroup[row.group].completed++;
    if (row.status === "passed") byGroup[row.group].passed++;
    else byGroup[row.group].failed++;
  }
  return {
    plannedTests: tests.length,
    completedTests: rows.length,
    passedTests: rows.filter(row => row.status === "passed").length,
    failedTests: rows.filter(row => row.status !== "passed").length,
    groups: Object.values(byGroup),
    updatedAt: new Date().toISOString(),
  };
}

function cmdRealCore(opts) {
  const ctx = createRunContext(opts);
  ensureRunBase(ctx);
  assertBuilt();
  const projects = readManifestProjects(ctx.manifestPath, "Real-Core");
  if (projects.length === 0) throw new Error(`no Real-Core projects in ${ctx.manifestPath}`);
  const selectedProjects = limitItems(projects, numberOr(opts.maxProjects, 0));
  const configs = selectedConfigIds(opts.config, CORE_CONFIGS);
  const projectListPath = path.join(ctx.runDir, "real_core_projects.txt");
  writeLines(projectListPath, selectedProjects);
  for (const configId of configs) {
    runBatchConfig(ctx, loadConfig(configId), projectListPath, "real_core");
  }
  cmdSummarize(opts);
}

function cmdRealScale(opts) {
  const ctx = createRunContext(opts);
  ensureRunBase(ctx);
  assertBuilt();
  const projects = readManifestProjects(ctx.manifestPath, "Real-Scale");
  if (projects.length === 0) throw new Error(`no Real-Scale projects in ${ctx.manifestPath}`);
  const selectedProjects = limitItems(projects, numberOr(opts.maxProjects, 0));
  const projectListPath = path.join(ctx.runDir, "real_scale_projects.txt");
  writeLines(projectListPath, selectedProjects);
  runBatchConfig(ctx, loadConfig(SCALE_CONFIG), projectListPath, "real_scale");
  cmdSummarize(opts);
}

function cmdSummarize(opts) {
  const ctx = createRunContext(opts);
  ensureDir(ctx.summaryDir);
  const configSummaries = [];
  for (const item of discoverBatchOutputs(ctx)) {
    const rows = readCsv(item.batchSummaryPath);
    configSummaries.push(summarizeBatchRows(item.configId, item.group, rows));
    copyIfExists(item.batchRunsPath, path.join(ctx.resultsDir, `${toResultStem(item.configId)}.jsonl`));
  }
  writeCsv(path.join(ctx.summaryDir, "real_project_result_summary.csv"), configSummaries);
  writeCsv(path.join(ctx.summaryDir, "runtime_by_config.csv"), configSummaries.map(runtimeSummaryRow));
  writeDiffIfPossible(ctx, "No2_base_ude", "No1_base", "flow_diff_no2_vs_no1.csv");
  writeDiffIfPossible(ctx, "No3_base_oclfs", "No1_base", "flow_diff_no3_vs_no1.csv");
  writeDiffIfPossible(ctx, "No4_full_engine", "No2_base_ude", "flow_diff_no4_vs_no2.csv");
  writeCapabilityAttribution(ctx, configSummaries);
  writeCumulativeCurve(ctx);
  writeSourceSinkStats(ctx);
  writeManualReviewTemplates(ctx);
  console.log(`summary_written ${ctx.summaryDir}`);
}

function cmdAllSmoke(opts) {
  const runId = opts.runId || makeRunId("smoke");
  const smokeOpts = {
    ...opts,
    runId,
    maxProjects: numberOr(opts.maxProjects, 1),
    realCoreProjects: numberOr(opts.realCoreProjects, numberOr(opts.maxProjects, 1)),
    projectTimeoutSeconds: numberOr(opts.projectTimeoutSeconds, 60),
    maxEntries: numberOr(opts.maxEntries, 40),
    maxKloc: numberOr(opts.maxKloc, 2),
  };
  cmdManifest(smokeOpts);
  cmdUnit({ ...smokeOpts, unitSmoke: true });
  cmdRealCore({ ...smokeOpts, config: opts.config || "No1_base,No4_full_engine" });
  console.log(`all_smoke_done runId=${runId}`);
}

function createRunContext(opts) {
  const runId = opts.runId || makeRunId("run");
  const outputRoot = path.resolve(opts.outputRoot || DEFAULT_OUTPUT_ROOT);
  const runDir = path.join(outputRoot, runId);
  return {
    runId,
    runDir,
    outputRoot,
    inventoryPath: path.resolve(opts.inventory || DEFAULT_INVENTORY),
    projectRoot: path.resolve(opts.projectRoot || DEFAULT_PROJECT_ROOT),
    manifestPath: path.resolve(opts.manifest || path.join(runDir, "test_manifest.csv")),
    summaryDir: path.join(runDir, "summary"),
    resultsDir: path.join(runDir, "results"),
    opts,
  };
}

function ensureRunBase(ctx) {
  if (!fs.existsSync(ctx.manifestPath)) {
    cmdManifest({
      ...ctx.opts,
      runId: ctx.runId,
      outputRoot: ctx.outputRoot,
      inventory: ctx.inventoryPath,
      projectRoot: ctx.projectRoot,
      manifest: ctx.manifestPath,
    });
  }
  ensureDir(ctx.resultsDir);
  ensureDir(ctx.summaryDir);
}

function buildManifestRows(ctx, limits) {
  if (!fs.existsSync(ctx.inventoryPath)) throw new Error(`inventory not found: ${ctx.inventoryPath}`);
  const inventory = readCsv(ctx.inventoryPath);
  const selected = filterExperimentInventoryRows(ctx, inventory, limits.maxProjects, limits.maxKloc);
  return selected.map((row, index) => {
    const projectName = row["名称"] || row.name || row.project || row.repo || "";
    const repoUrl = row.html_url || row["来源地址"] || row.source || "";
    const localPath = findLocalProjectPath(ctx.projectRoot, row, projectName);
    const facts = collectProjectFacts(localPath);
    const groups = ["Real-Scale"];
    if (index < limits.realCoreProjects) groups.unshift("Real-Core");
    if (index < limits.caseStudyProjects) groups.push("Case-Study");
    return {
      project_id: safeName(projectName),
      project_name: projectName,
      repo_url: repoUrl,
      local_path: localPath,
      source_dir: facts.sourceDirs.join(";"),
      KLOC: facts.kloc.toFixed(3),
      ets_files: facts.etsFiles,
      ts_files: facts.tsFiles,
      entry_count: facts.entryCount,
      stars: row.stars || "",
      forks: row.forks || "",
      watchers_subscribers: row.watchers_subscribers || "",
      total_issues: row.total_issues || "",
      total_prs: row.total_prs || "",
      run_group: groups.join(";"),
    };
  });
}

function filterExperimentInventoryRows(ctx, rows, maxRows, maxKloc) {
  const out = [];
  for (const row of rows) {
    const normalized = {
      ...row,
      name: row[FIELD_NAME] || row.name || row.project || row.repo || "",
      source_url: row.html_url || row[FIELD_SOURCE_URL] || row.source || "",
    };
    if (hasIdentityDemoMarkerText([
      normalized.name,
      normalized.repo || "",
      normalized.owner || "",
      normalized.html_url || "",
      normalized.source_url || "",
      normalized[FIELD_DESCRIPTION] || "",
    ].join("\n"))) continue;
    const localPath = findLocalProjectPath(ctx.projectRoot, normalized, normalized.name);
    const facts = collectProjectFacts(localPath);
    if (maxKloc > 0 && facts.kloc > maxKloc) continue;
    const gate = experimentEligibilityGate(normalized, normalized.name, localPath, facts);
    if (!gate.eligible) continue;
    out.push(normalized);
    if (maxRows > 0 && out.length >= maxRows) break;
  }
  return out;
}

function findLocalProjectPath(projectRoot, row, projectName) {
  const host = String(row.host || "").split(".")[0];
  const owner = row.owner || "";
  const repo = row.repo || "";
  const candidates = [
    projectName,
    repo,
    `${owner}_${repo}`,
    `${host}_${owner}_${repo}`,
    `github_${owner}_${repo}`,
    `gitee_${owner}_${repo}`,
    `gitcode_${owner}_${repo}`,
  ].map(safeName).filter(Boolean);
  for (const candidate of candidates) {
    const direct = path.join(projectRoot, candidate);
    if (fs.existsSync(direct)) return direct;
  }
  let entries = [];
  try {
    entries = fs.readdirSync(projectRoot, { withFileTypes: true });
  } catch {
    return path.join(projectRoot, safeName(projectName));
  }
  const exact = new Set(candidates.map(candidate => candidate.toLowerCase()));
  for (const entry of entries) {
    if (entry.isDirectory() && exact.has(entry.name.toLowerCase())) return path.join(projectRoot, entry.name);
  }
  const repoLower = safeName(repo).toLowerCase();
  if (repoLower) {
    const hit = entries.find(entry => entry.isDirectory() && safeName(entry.name).toLowerCase().endsWith(`_${repoLower}`));
    if (hit) return path.join(projectRoot, hit.name);
  }
  return path.join(projectRoot, safeName(projectName));
}

function experimentEligibilityGate(row, projectName, localPath, facts) {
  if (!fs.existsSync(localPath)) return { eligible: false, reason: "missing_local_path" };
  if (facts.etsFiles <= 0) return { eligible: false, reason: "no_ets_files" };
  if (!facts.hasHarmonyConfig) return { eligible: false, reason: "missing_harmony_config" };
  if (isDemoOnlySourceLayout(facts.sourceDirs)) return { eligible: false, reason: "demo_only_source_layout" };
  if (hasIdentityDemoMarkerText([projectName, row.repo || "", row.owner || "", row.html_url || "", row.source_url || ""].join("\n"))) {
    return { eligible: false, reason: "demo_or_tutorial_identity" };
  }
  const text = [
    projectName,
    row.repo || "",
    row.owner || "",
    row.html_url || "",
    row.source_url || "",
    row[FIELD_DESCRIPTION] || "",
    readProjectIntro(localPath),
  ].join("\n").toLowerCase();
  if (hasDemoMarkerText(text)) return { eligible: false, reason: "demo_or_tutorial_content" };
  return { eligible: true, reason: "eligible" };
}

function hasIdentityDemoMarkerText(text) {
  return /demo|sample|example|codelab|tutorial|template|guide-snippets|示例|样例|教程|演示|模板/i.test(String(text || ""));
}

function isDemoOnlySourceLayout(sourceDirs) {
  const tops = new Set();
  for (const dir of sourceDirs || []) {
    const normalized = String(dir || "").replace(/\\/g, "/");
    if (!normalized || normalized === "." || /(^|\/)(test|ohostest|__tests__)(\/|$)/i.test(normalized)) continue;
    const top = normalized.split("/").filter(Boolean)[0] || "";
    if (top) tops.add(top);
  }
  if (tops.size === 0) return false;
  const demoTop = /^(demos?|samples?|examples?|codelabs?|tutorials?|templates?|hellostage|quickstart\d*|chapter\d+)$/i;
  return [...tops].every(top => demoTop.test(top));
}

function hasDemoMarkerText(text) {
  const value = String(text || "").toLowerCase();
  const demoPatterns = [
    /\bcodelab\b/,
    /\btutorial\b/,
    /\btemplate\b/,
    /\bexample\b/,
    /\bsample\b/,
    /\bsamples\b/,
    /\bdemo\b/,
    /\bguide-snippets\b/,
    /示例/,
    /样例/,
    /教程/,
    /课程演示/,
    /演示项目/,
    /模板/,
  ];
  return demoPatterns.some(pattern => pattern.test(value));
}

function readProjectIntro(localPath) {
  for (const name of ["README.md", "README.zh-CN.md", "README_CN.md", "readme.md"]) {
    const file = path.join(localPath, name);
    if (fs.existsSync(file)) return readTextSafe(file).slice(0, 12000);
  }
  return "";
}

function collectProjectFacts(localPath) {
  const files = [];
  let hasHarmonyConfig = false;
  if (fs.existsSync(localPath)) {
    walkFiles(localPath, files);
  }
  let lines = 0;
  let etsFiles = 0;
  let tsFiles = 0;
  let entryCount = 0;
  const sourceDirs = new Set();
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    const base = path.basename(file).toLowerCase();
    if (base === "module.json5" || base === "app.json5" || base === "build-profile.json5" || base.startsWith("hvigorfile")) {
      hasHarmonyConfig = true;
    }
    if (ext !== ".ets" && ext !== ".ts") continue;
    if (ext === ".ets") etsFiles++;
    if (ext === ".ts") tsFiles++;
    const rel = path.relative(localPath, file).replace(/\\/g, "/");
    const sourceDir = inferSourceDir(rel);
    if (sourceDir) sourceDirs.add(sourceDir);
    const text = readTextSafe(file);
    lines += text.length > 0 ? text.split(/\r?\n/).length : 0;
    if (text.includes("@Entry") || /EntryAbility\.ets$/i.test(rel)) entryCount++;
  }
  return {
    sourceDirs: [...sourceDirs].sort(),
    kloc: lines / 1000,
    etsFiles,
    tsFiles,
    entryCount,
    hasHarmonyConfig,
  };
}

function walkFiles(dir, out) {
  const ignored = new Set([".git", "node_modules", "oh_modules", "build", "out", ".hvigor", ".idea", ".preview"]);
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
}

function inferSourceDir(rel) {
  const parts = rel.split("/");
  for (let i = 0; i + 2 < parts.length; i++) {
    if (parts[i] === "src" && parts[i + 1] === "main" && parts[i + 2] === "ets") {
      return parts.slice(0, i + 3).join("/");
    }
  }
  return path.dirname(rel);
}

function runNpmUnit(ctx, unitDir, test) {
  const logPath = path.join(unitDir, `${safeName(test.script)}.log`);
  const started = Date.now();
  const result = runCommand(ctx, npmCommand(), ["run", test.script], logPath, { cwd: ROOT });
  return {
    group: test.group,
    mechanism: test.mechanism,
    script: test.script,
    status: result.status,
    exitCode: result.exitCode,
    elapsedMs: Date.now() - started,
    logPath,
  };
}

function runBatchConfig(ctx, config, projectListPath, group) {
  const outDir = path.join(ctx.runDir, group, config.id);
  ensureDir(outDir);
  const logPath = path.join(outDir, "batch_runner.log");
  const timeoutSeconds = numberOr(ctx.opts.projectTimeoutSeconds, config.projectTimeoutSeconds || 480);
  const args = [
    "out/tools/real_project_batch_analyze.js",
    "--projectRoot", ctx.projectRoot,
    "--outputDir", outDir,
    "--projectsFile", projectListPath,
    "--projectTimeoutSeconds", String(timeoutSeconds),
    "--executionHandoff", config.executionHandoff,
    "--currentness", config.currentness,
    "--reportMode", config.reportMode || "full",
    "--entryModel", config.entryModel || "arkMain",
    "--maxEntries", String(numberOr(ctx.opts.maxEntries, config.maxEntries || 9999)),
    "--worklistBudgetMs", String(config.worklistBudgetMs || 45000),
    "--sourceDirMode", config.sourceDirMode || "auto",
    "--concurrency", String(numberOr(ctx.opts.concurrency, 1)),
  ];
  if (ctx.opts.maxProjects && ctx.opts.maxProjects > 0) {
    args.push("--maxProjects", String(ctx.opts.maxProjects));
  }
  if (ctx.opts.skipExisting) args.push("--skipExisting");
  const autoModel = ctx.opts.autoModel === true || config.autoModel === true;
  if (autoModel) {
    args.push("--autoModel");
    if (ctx.opts.llmProfile) args.push("--llmProfile", ctx.opts.llmProfile);
    if (ctx.opts.model) args.push("--model", ctx.opts.model);
    args.push("--maxLlmItems", String(numberOr(ctx.opts.maxLlmItems, config.maxLlmItems || 12)));
  }
  const started = Date.now();
  const result = runCommand(ctx, process.execPath, args, logPath, { cwd: ROOT });
  writeJson(path.join(outDir, "chapter3_config.json"), config);
  writeJson(path.join(outDir, "chapter3_run_result.json"), {
    configId: config.id,
    group,
    projectListPath,
    status: result.status,
    exitCode: result.exitCode,
    elapsedMs: Date.now() - started,
    logPath,
  });
}

function runCommand(ctx, command, args, logPath, options) {
  ensureDir(path.dirname(logPath));
  const commandRecord = {
    runId: ctx.runId,
    startedAt: new Date().toISOString(),
    command,
    args,
    cwd: options.cwd || ROOT,
    logPath,
  };
  appendJsonl(path.join(ctx.runDir, "commands.jsonl"), commandRecord);
  const outFd = fs.openSync(logPath, "w");
  const errFd = fs.openSync(logPath, "a");
  let result;
  try {
    result = spawnSync(command, args, {
      cwd: options.cwd || ROOT,
      stdio: ["ignore", outFd, errFd],
      shell: process.platform === "win32",
      windowsHide: true,
    });
  } finally {
    fs.closeSync(outFd);
    fs.closeSync(errFd);
  }
  if (result && result.error) {
    fs.appendFileSync(logPath, `\n[chapter3-runner-spawn-error] ${String(result.error.stack || result.error.message || result.error)}\n`, "utf-8");
  }
  const exitCode = result && typeof result.status === "number" ? result.status : 1;
  const status = exitCode === 0 ? "passed" : "failed";
  appendJsonl(path.join(ctx.runDir, "commands.jsonl"), {
    ...commandRecord,
    finishedAt: new Date().toISOString(),
    status,
    exitCode,
    signal: result && result.signal || "",
    error: result && result.error ? String(result.error.message || result.error) : "",
  });
  return { status, exitCode };
}

function discoverBatchOutputs(ctx) {
  const out = [];
  for (const group of ["real_core", "real_scale"]) {
    const groupDir = path.join(ctx.runDir, group);
    if (!fs.existsSync(groupDir)) continue;
    for (const entry of fs.readdirSync(groupDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(groupDir, entry.name);
      const batchSummaryPath = path.join(dir, "batch_summary.csv");
      const batchRunsPath = path.join(dir, "batch_runs.jsonl");
      if (fs.existsSync(batchSummaryPath)) {
        out.push({ group, configId: entry.name, batchSummaryPath, batchRunsPath });
      }
    }
  }
  return out;
}

function summarizeBatchRows(configId, group, rows) {
  const elapsed = rows.map(row => toNumber(row.elapsedMs)).filter(Number.isFinite).sort((a, b) => a - b);
  const flowTotal = sum(rows.map(row => toNumber(row.totalFlows)));
  const projects = rows.length;
  const done = rows.filter(row => row.status === "done").length;
  const timedOut = rows.filter(row => row.status === "timeout").length;
  const failed = rows.filter(row => row.status === "failed").length;
  const withFlows = rows.filter(row => toNumber(row.totalFlows) > 0).length;
  const exceptionCount = sum(rows.map(row => toNumber(row.analysisExceptionCount)));
  const budgetExceeded = sum(rows.map(row => toNumber(row.analysisBudgetExceededCount)));
  return {
    config_id: configId,
    group,
    projects,
    done_projects: done,
    success_rate: ratio(done, projects),
    projects_with_flows: withFlows,
    reported_flows: flowTotal,
    analysis_exception_count: exceptionCount,
    analysis_budget_exceeded_count: budgetExceeded,
    median_elapsed_ms: percentile(elapsed, 0.5),
    p95_elapsed_ms: percentile(elapsed, 0.95),
    timeout_projects: timedOut,
    failed_projects: failed,
  };
}

function runtimeSummaryRow(row) {
  return {
    config_id: row.config_id,
    group: row.group,
    median_elapsed_ms: row.median_elapsed_ms,
    p95_elapsed_ms: row.p95_elapsed_ms,
    timeout_projects: row.timeout_projects,
    failed_projects: row.failed_projects,
    reported_flows: row.reported_flows,
  };
}

function writeDiffIfPossible(ctx, variantId, baseId, fileName) {
  const variant = readBatchRowsForConfig(ctx, variantId);
  const base = readBatchRowsForConfig(ctx, baseId);
  if (!variant || !base) return;
  const baseByProject = new Map(base.map(row => [row.project, row]));
  const rows = variant.map(row => {
    const before = baseByProject.get(row.project);
    const baseFlows = before ? toNumber(before.totalFlows) : 0;
    const variantFlows = toNumber(row.totalFlows);
    return {
      project: row.project,
      base_config: baseId,
      variant_config: variantId,
      base_status: before ? before.status : "missing",
      variant_status: row.status,
      base_flows: baseFlows,
      variant_flows: variantFlows,
      delta_flows: variantFlows - baseFlows,
    };
  });
  writeCsv(path.join(ctx.summaryDir, fileName), rows);
  copyIfExists(path.join(ctx.summaryDir, fileName), path.join(ctx.resultsDir, fileName));
}

function readBatchRowsForConfig(ctx, configId) {
  for (const group of ["real_core", "real_scale"]) {
    const p = path.join(ctx.runDir, group, configId, "batch_summary.csv");
    if (fs.existsSync(p)) return readCsv(p);
  }
  return undefined;
}

function writeCapabilityAttribution(ctx, summaries) {
  const byId = new Map(summaries.map(row => [row.config_id, row]));
  const no1 = byId.get("No1_base");
  const no2 = byId.get("No2_base_ude");
  const no3 = byId.get("No3_base_oclfs");
  const no4 = byId.get("No4_full_engine");
  const rows = [];
  if (no1 && no2) rows.push(capabilityRow("UDE", no2.reported_flows - no1.reported_flows, no2.projects_with_flows - no1.projects_with_flows, "No2_base_ude minus No1_base"));
  if (no1 && no3) rows.push(capabilityRow("OCLFS", no3.reported_flows - no1.reported_flows, no3.projects_with_flows - no1.projects_with_flows, "No3_base_oclfs minus No1_base; negative delta is expected when stale flows are suppressed"));
  if (no2 && no4) rows.push(capabilityRow("UDE+OCLFS", no4.reported_flows - no2.reported_flows, no4.projects_with_flows - no2.projects_with_flows, "No4_full_engine minus No2_base_ude"));
  writeCsv(path.join(ctx.summaryDir, "capability_contribution_attribution.csv"), rows);
}

function capabilityRow(capability, deltaFlows, deltaProjects, note) {
  return {
    capability,
    delta_reported_flows: deltaFlows,
    delta_projects_with_flows: deltaProjects,
    manual_valid_rate: "pending_manual_review",
    high_confidence_risk_candidates: "pending_manual_review",
    note,
  };
}

function writeCumulativeCurve(ctx) {
  const rows = readBatchRowsForConfig(ctx, SCALE_CONFIG) || readBatchRowsForConfig(ctx, "No4_full_engine") || [];
  let cumulativeFlows = 0;
  const out = rows.map((row, index) => {
    cumulativeFlows += toNumber(row.totalFlows);
    return {
      project_index: index + 1,
      project: row.project,
      status: row.status,
      project_flows: toNumber(row.totalFlows),
      cumulative_flows: cumulativeFlows,
      elapsed_ms: toNumber(row.elapsedMs),
    };
  });
  writeCsv(path.join(ctx.summaryDir, "cumulative_discovery_curve.csv"), out);
}

function writeSourceSinkStats(ctx) {
  const rows = [];
  for (const item of discoverBatchOutputs(ctx)) {
    const batchRows = readCsv(item.batchSummaryPath);
    for (const batchRow of batchRows) {
      const summary = readJsonSafe(batchRow.summaryJson);
      const agg = summary && summary.summary ? summary.summary : {};
      const sourceEndpoints = agg.ruleHitEndpoints?.source || {};
      const sinkEndpoints = agg.ruleHitEndpoints?.sink || {};
      const sourceTotal = sum(Object.values(sourceEndpoints).map(toNumber));
      const sinkTotal = sum(Object.values(sinkEndpoints).map(toNumber));
      rows.push({
        config_id: item.configId,
        project: batchRow.project,
        source_endpoint_total: sourceTotal,
        sink_endpoint_total: sinkTotal,
        reported_flows: toNumber(batchRow.totalFlows),
        source_endpoint_breakdown: compactJson(sourceEndpoints),
        sink_endpoint_breakdown: compactJson(sinkEndpoints),
        pair_status: "requires_flow_detail_or_manual_review",
      });
    }
  }
  writeCsv(path.join(ctx.summaryDir, "source_sink_type_stats.csv"), rows);
}

function writeManualReviewTemplates(ctx) {
  const dir = path.join(ctx.runDir, "manual_review_inputs");
  ensureDir(dir);
  writeCsv(path.join(dir, "manual_flow_review_template.csv"), [{
    config_id: "",
    project: "",
    flow_id: "",
    source: "",
    propagation: "",
    sink: "",
    judgement: "valid_flow|normal_business_flow|stale_fp|false_positive|uncertain",
    risk_candidate: "yes|no",
    reviewer: "",
    evidence: "",
  }]);
  writeCsv(path.join(dir, "high_confidence_risk_candidates.csv"), [{
    candidate_id: "",
    project: "",
    source: "",
    sink: "",
    propagation_mechanism: "",
    risk_type: "",
    confidence: "High|Medium",
    severity: "High|Medium|Low",
    status: "manual_confirmed|pending_review",
    evidence_path: "",
  }]);
}

function writeExperimentManifest(ctx, manifestRows) {
  const configs = [...CORE_CONFIGS, SCALE_CONFIG].map(id => loadConfig(id));
  writeJson(path.join(ctx.runDir, "experiment_manifest.json"), {
    runId: ctx.runId,
    generatedAt: new Date().toISOString(),
    gitCommit: gitText(["rev-parse", "HEAD"]),
    gitBranch: gitText(["rev-parse", "--abbrev-ref", "HEAD"]),
    nodeVersion: process.version,
    platform: process.platform,
    inventoryPath: ctx.inventoryPath,
    inventoryHash: hashFileIfExists(ctx.inventoryPath),
    projectRoot: ctx.projectRoot,
    manifestPath: ctx.manifestPath,
    manifestRows: manifestRows.length,
    configDir: path.resolve(CONFIG_DIR),
    configHash: hashStrings(configs.map(config => JSON.stringify(config))),
    configs,
  });
}

function summarizeManifest(rows) {
  return {
    totalProjects: rows.length,
    realCoreProjects: rows.filter(row => String(row.run_group).includes("Real-Core")).length,
    realScaleProjects: rows.filter(row => String(row.run_group).includes("Real-Scale")).length,
    caseStudyProjects: rows.filter(row => String(row.run_group).includes("Case-Study")).length,
    totalKloc: sum(rows.map(row => Number(row.KLOC || 0))),
    totalEtsFiles: sum(rows.map(row => Number(row.ets_files || 0))),
  };
}

function readManifestProjects(manifestPath, group) {
  return readCsv(manifestPath)
    .filter(row => String(row.run_group || "").split(";").includes(group))
    .map(row => row.project_name)
    .filter(Boolean);
}

function selectedConfigIds(value, defaults) {
  if (!value) return defaults;
  const allowed = new Set([...CORE_CONFIGS, SCALE_CONFIG]);
  return value.split(",").map(item => item.trim()).filter(Boolean).map(item => {
    if (!allowed.has(item)) throw new Error(`unknown config id: ${item}`);
    return item;
  });
}

function loadConfig(id) {
  const file = path.join(CONFIG_DIR, `${id}.json`);
  if (!fs.existsSync(file)) throw new Error(`config not found: ${file}`);
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

function toResultStem(configId) {
  if (configId === "No1_base") return "real_core_no1";
  if (configId === "No2_base_ude") return "real_core_no2";
  if (configId === "No3_base_oclfs") return "real_core_no3";
  if (configId === "No4_full_engine") return "real_core_no4";
  if (configId === SCALE_CONFIG) return "real_scale_no5";
  return configId;
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\"") {
      if (quoted && line[i + 1] === "\"") {
        cur += "\"";
        i++;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function readCsv(file) {
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, "utf-8").split(/\r?\n/).filter(line => line.length > 0);
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]).map(key => key.replace(/^\uFEFF/, ""));
  return lines.slice(1).map(line => {
    const cells = parseCsvLine(line);
    const row = {};
    header.forEach((key, index) => row[key] = cells[index] === undefined ? "" : cells[index]);
    return row;
  });
}

function writeCsv(file, rows) {
  ensureDir(path.dirname(file));
  const header = collectHeader(rows);
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(header.map(key => csvEscape(row[key])).join(","));
  }
  fs.writeFileSync(file, `${lines.join("\n")}\n`, "utf-8");
}

function collectHeader(rows) {
  const keys = [];
  const seen = new Set();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
  }
  return keys.length > 0 ? keys : ["empty"];
}

function csvEscape(value) {
  const text = value === undefined || value === null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function readJsonSafe(file) {
  try {
    if (!file || !fs.existsSync(file)) return undefined;
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return undefined;
  }
}

function parseManualFlowLedger(file, projectId) {
  const text = fs.readFileSync(file, "utf-8").replace(/^\uFEFF/, "");
  const rows = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("|")) continue;
    if (!/^\|\s*F\d{3,}\s*\|/.test(line)) continue;
    const cells = parseMarkdownTableLine(line);
    if (cells.length < 6) continue;
    rows.push({
      project_id: projectId,
      flow_id: cells[0],
      classification: normalizeFlowClassification(cells[1]),
      source: cells[2],
      propagation: cells[3],
      sink: cells[4],
      conclusion: cells.slice(5).join(" | "),
      ledger_path: file,
    });
  }
  return rows;
}

function parseMarkdownTableLine(line) {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map(cell => cell.trim().replace(/<br\s*\/?>/gi, " "));
}

function normalizeFlowClassification(value) {
  return String(value || "unknown")
    .replace(/`/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function countBy(items, keyFn) {
  const out = {};
  for (const item of items) {
    const key = keyFn(item);
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function countFlowsByPrefix(flows, classification) {
  return flows.filter(flow => flow.classification === classification).length;
}

function classifyAuditEngineGap(manualFlowCount, engineFlowCount, hasEngine) {
  if (!hasEngine) return "engine_result_missing";
  if (manualFlowCount === 0 && engineFlowCount === 0) return "no_manual_no_engine_flow";
  if (manualFlowCount > 0 && engineFlowCount === 0) return "manual_flows_engine_zero";
  if (manualFlowCount === 0 && engineFlowCount > 0) return "engine_flows_without_manual_ledger";
  if (engineFlowCount < manualFlowCount) return "engine_less_than_manual";
  if (engineFlowCount === manualFlowCount) return "engine_count_equal_manual";
  return "engine_more_than_manual";
}

function summarizeAuditCompare(projectRows, flowRows) {
  const classCounts = countBy(flowRows, flow => flow.classification || "unknown");
  const gapCounts = countBy(projectRows, row => row.audit_engine_gap || "unknown");
  return {
    generatedAt: new Date().toISOString(),
    projects: projectRows.length,
    projectsWithFullLedger: projectRows.filter(row => row.has_full_taint_flow_reaudit === "yes").length,
    projectsWithEngineFlows: projectRows.filter(row => row.has_engine_flows === "yes").length,
    manualFlows: flowRows.length,
    vulnerabilityFlows: classCounts.vulnerability_flow || 0,
    ordinaryValidFlows: classCounts.ordinary_valid_taint_flow || 0,
    normalBusinessFlows: classCounts.normal_business_flow || 0,
    hardeningObservations: classCounts.hardening_observation || 0,
    partialFlows: classCounts.partial_flow || 0,
    excludedFlows: classCounts.excluded || 0,
    otherClassCounts: classCounts,
    totalEngineFlows: sum(projectRows.map(row => row.engine_flow_count)),
    totalManualDiffMissed: sum(projectRows.map(row => row.manual_diff_missed_count)),
    totalManualDiffFalsePositive: sum(projectRows.map(row => row.manual_diff_false_positive_count)),
    totalManualDiffDuplicate: sum(projectRows.map(row => row.manual_diff_duplicate_count)),
    totalManualDiffUnresolved: sum(projectRows.map(row => row.manual_diff_unresolved_count)),
    auditEngineGapCounts: gapCounts,
  };
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function appendJsonl(file, value) {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`, "utf-8");
}

function writeLines(file, values) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${values.join("\n")}\n`, "utf-8");
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function assertBuilt() {
  if (!fs.existsSync(path.join(ROOT, "out", "cli", "analyze.js"))
      || !fs.existsSync(path.join(ROOT, "out", "tools", "real_project_batch_analyze.js"))) {
    throw new Error("compiled output is missing; run npm run build before Chapter 3 experiments");
  }
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function numberOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function limitItems(items, max) {
  return max > 0 ? items.slice(0, max) : items;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function boolText(value) {
  if (value === true) return "true";
  if (value === false) return "false";
  return "";
}

function sum(values) {
  return values.reduce((acc, value) => acc + toNumber(value), 0);
}

function ratio(n, d) {
  return d > 0 ? (n / d).toFixed(4) : "0.0000";
}

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.ceil(sortedValues.length * p) - 1);
  return Math.round(sortedValues[index]);
}

function safeName(value) {
  return String(value || "unknown").replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
}

function makeRunId(prefix) {
  return `${prefix}_${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

function readTextSafe(file) {
  try {
    return fs.readFileSync(file, "utf-8");
  } catch {
    return "";
  }
}

function copyIfExists(src, dst) {
  if (!fs.existsSync(src)) return;
  ensureDir(path.dirname(dst));
  fs.copyFileSync(src, dst);
}

function compactJson(value) {
  return JSON.stringify(value || {});
}

function hashFileIfExists(file) {
  if (!fs.existsSync(file)) return "";
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function hashStrings(values) {
  const h = crypto.createHash("sha256");
  for (const value of values) h.update(value);
  return h.digest("hex");
}

function gitText(args) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf-8", windowsHide: true });
  return result.status === 0 ? result.stdout.trim() : "";
}

main();
