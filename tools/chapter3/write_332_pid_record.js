const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../..");
const group = process.argv[2] || "internal_docs/reports/chapter3_experiment_artifacts/final/runs/33_llm_asset_generation/model_stability/semanticflow_332/four_models_332_20260630_040400";
const groupDir = path.isAbsolute(group) ? group : path.resolve(repoRoot, group);
const recordPath = path.join(groupDir, "background_group_record.json");
const record = JSON.parse(fs.readFileSync(recordPath, "utf8"));

const pids = record.runs.map(run => run.pid).join(",");
const lines = [
  "# Chapter 3.3.2 Four-Model Background PID Record",
  "",
  `Group ID: \`${record.groupId}\``,
  `Dataset: \`${record.dataset}\``,
  `Started at: \`${record.startedAt}\``,
  `Output root: \`${record.baseOutputDir}\``,
  `Expected requests per profile: \`${record.expectedRequestsPerProfile}\``,
  "",
  "| Profile | PID | Output Dir | stdout | stderr | Timeout | Request Attempts |",
  "|---|---:|---|---|---|---:|---:|",
  ...record.runs.map(run => `| \`${run.profile}\` | \`${run.pid}\` | \`${run.outputDir}\` | \`${run.stdout}\` | \`${run.stderr}\` | \`${run.timeoutMs}\` | \`${run.requestMaxAttempts}\` |`),
  "",
  "Check command:",
  "```powershell",
  `Get-Process -Id ${pids} -ErrorAction SilentlyContinue`,
  "```",
  "",
  "Progress check:",
  "```powershell",
  `$root = "${toWindowsPath(record.baseOutputDir)}"`,
  `Get-ChildItem $root -Directory | ForEach-Object { $raw = Join-Path $_.FullName "raw_records.jsonl"; [pscustomobject]@{profile=$_.Name; rawRecords=if(Test-Path $raw){(Get-Content $raw | Measure-Object -Line).Lines}else{0}} }`,
  "```",
  "",
].join("\n");

const inRun = path.join(groupDir, "PID_RECORD.md");
const inReports = path.join(repoRoot, "internal_docs/reports/chapter3_332_background_pid_record.md");
fs.writeFileSync(inRun, lines, "utf8");
fs.writeFileSync(inReports, lines, "utf8");
console.log(JSON.stringify({
  pidRecordInRun: inRun,
  pidRecordInReports: inReports,
}, null, 2));

function toWindowsPath(value) {
  return String(value || "").replace(/\//g, "\\");
}
