import * as fs from "fs";
import * as path from "path";
import { runShellOrThrow } from "./ProcessRunner";
import { ArktanRunnerReport, CliOptions, ScenarioStaticData } from "./TransferCompareTypes";

export function ensureArktanRunnerScript(outputDir: string): string {
    const runnerPath = path.join(outputDir, "arktan_compare_runner.ts");
    const source = `
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

interface RunnerArgs {
  arktanRoot: string;
  projectDir: string;
  payloadPath: string;
}

function parseArgs(argv: string[]): RunnerArgs {
  let arktanRoot = "";
  let projectDir = "";
  let payloadPath = "";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--arktanRoot" && i + 1 < argv.length) { arktanRoot = argv[++i]; continue; }
    if (arg.startsWith("--arktanRoot=")) { arktanRoot = arg.slice("--arktanRoot=".length); continue; }
    if (arg === "--projectDir" && i + 1 < argv.length) { projectDir = argv[++i]; continue; }
    if (arg.startsWith("--projectDir=")) { projectDir = arg.slice("--projectDir=".length); continue; }
    if (arg === "--payload" && i + 1 < argv.length) { payloadPath = argv[++i]; continue; }
    if (arg.startsWith("--payload=")) { payloadPath = arg.slice("--payload=".length); continue; }
  }
  if (!arktanRoot) throw new Error("missing --arktanRoot");
  if (!projectDir) throw new Error("missing --projectDir");
  if (!payloadPath) throw new Error("missing --payload");
  return { arktanRoot: path.resolve(arktanRoot), projectDir: path.resolve(projectDir), payloadPath: path.resolve(payloadPath) };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^$()|[\\\\]\\\\]/g, "\\\\$&");
}

function extractFilePathFromSignature(signature: string): string {
  const m = signature.match(/@([^:>]+):/);
  return m ? m[1].replace(/\\\\/g, "/") : signature;
}

function matchStringConstraint(constraint: any, text: string): boolean {
  if (!constraint) return true;
  const mode = String(constraint.mode || "equals");
  const value = String(constraint.value || "");
  if (mode === "equals") return text === value;
  if (mode === "contains") return text.includes(value);
  try {
    return new RegExp(value).test(text);
  } catch {
    return false;
  }
}

function matchesScope(candidate: any, method: any, signature: string, classText: string): boolean {
  const scope = candidate.scope;
  if (!scope) return true;
  const filePath = extractFilePathFromSignature(signature);
  const moduleText = signature || filePath;
  const methodName = method.getName();
  if (!matchStringConstraint(scope.file, filePath)) return false;
  if (!matchStringConstraint(scope.module, moduleText)) return false;
  if (!matchStringConstraint(scope.className, classText)) return false;
  if (!matchStringConstraint(scope.methodName, methodName)) return false;
  return true;
}

function matchesCandidate(method: any, candidate: any): boolean {
  const signature = method.getSignature().toString();
  const classSig = method.getDeclaringArkClass()?.getSignature?.()?.toString?.() || "";
  const className = method.getDeclaringArkClass()?.getName?.() || "";
  const methodName = method.getName();
  const matchKind = String(candidate.matchKind || "");
  const matchValue = String(candidate.matchValue || "");

  let basicMatch = false;
  if (matchKind === "method_name_equals") {
    basicMatch = methodName === matchValue;
  } else if (matchKind === "method_name_regex") {
    try { basicMatch = new RegExp(matchValue).test(methodName); } catch { basicMatch = false; }
  } else if (matchKind === "declaring_class_equals") {
    basicMatch = classSig === matchValue || className === matchValue;
  } else if (matchKind === "signature_equals" || matchKind === "callee_signature_equals") {
    basicMatch = signature === matchValue;
  } else if (matchKind === "signature_contains") {
    basicMatch = signature.includes(matchValue);
  } else if (matchKind === "signature_regex") {
    try { basicMatch = new RegExp(matchValue).test(signature); } catch { basicMatch = false; }
  } else {
    basicMatch = false;
  }
  if (!basicMatch) return false;

  const invokeKind = String(candidate.invokeKind || "");
  if (invokeKind === "instance" && method.isStatic?.()) return false;
  if (invokeKind === "static" && !method.isStatic?.()) return false;

  if (candidate.argCount !== undefined && candidate.argCount !== null) {
    const expected = Number(candidate.argCount);
    const actual = method.getParameterInstances().length;
    if (expected !== actual) return false;
  }

  if (candidate.typeHint) {
    const hint = String(candidate.typeHint).toLowerCase();
    const haystack = (signature + " " + classSig + " " + className).toLowerCase();
    if (!haystack.includes(hint)) return false;
  }

  if (!matchesScope(candidate, method, signature, classSig)) return false;
  return true;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const payload = JSON.parse(fs.readFileSync(args.payloadPath, "utf-8"));
  const configMod = require(path.join(args.arktanRoot, "Arkanalyzer", "Config.ts"));
  const sceneMod = require(path.join(args.arktanRoot, "Arkanalyzer", "Scene.ts"));
  const ptaMod = require(path.join(args.arktanRoot, "PointerAnalysis", "Mypta", "MyPointerAnalysis.ts"));
  const taintCfgMod = require(path.join(args.arktanRoot, "PointerAnalysis", "Mypta", "config", "TaintConfig.ts"));
  const SceneConfig = configMod.SceneConfig;
  const Scene = sceneMod.Scene;
  const MyPointerAnalysis = ptaMod.MyPointerAnalysis;
  const TaintConfig = taintCfgMod.TaintConfig;

  const sceneConfig = new SceneConfig();
  sceneConfig.buildFromProjectDir(args.projectDir);
  const scene = new Scene();
  scene.buildSceneFromProjectDir(sceneConfig);
  scene.inferTypes();

  const methods = scene.getMethods();
  const methodsByName = new Map<string, any[]>();
  for (const m of methods) {
    const arr = methodsByName.get(m.getName()) || [];
    arr.push(m);
    methodsByName.set(m.getName(), arr);
  }

  const sources: any[] = [];
  const missingCaseMethods: string[] = [];
  for (const caseName of payload.caseNames as string[]) {
    const matched = methodsByName.get(caseName) || [];
    const withParam = matched.filter((m: any) => m.getParameterInstances().length > 0);
    if (withParam.length === 0) { missingCaseMethods.push(caseName); continue; }
    sources.push({ kind: "param", method: withParam[0].getSignature().toString(), index: 0 });
  }

  const sinks: any[] = [];
  const sinkMethods = methodsByName.get(payload.sinkMethodName as string) || [];
  for (const m of sinkMethods) sinks.push({ method: m.getSignature().toString(), index: 0 });

  const transferSet = new Set<string>();
  const transfers: any[] = [];
  for (const candidate of payload.transferCandidates as any[]) {
    for (const m of methods) {
      if (!matchesCandidate(m, candidate)) continue;
      const key = m.getSignature().toString() + "|" + candidate.from + "|" + candidate.to;
      if (transferSet.has(key)) continue;
      transferSet.add(key);
      transfers.push({ method: m.getSignature().toString(), from: candidate.from, to: candidate.to });
    }
  }

  const ymlObject = { sources, sinks, transfers };
  const ymlPath = path.join(path.dirname(args.payloadPath), "arktan_generated_" + payload.scenarioId + ".yml");
  fs.writeFileSync(ymlPath, yaml.dump(ymlObject), "utf-8");

  const pta = new MyPointerAnalysis(scene);
  pta.config = new TaintConfig(scene, ymlPath);

  const oldLog = console.log;
  const lines: string[] = [];
  console.log = (...args2: any[]) => {
    const line = args2.map(a => String(a)).join(" ");
    lines.push(line);
    oldLog(...args2);
  };

  const t0 = process.hrtime.bigint();
  try {
    pta.start();
  } finally {
    console.log = oldLog;
  }
  const dtNs = process.hrtime.bigint() - t0;
  const elapsedMs = Number(dtNs) / 1_000_000;

  const flowLines = lines.filter(line => line.includes("Taintflow{"));
  const detectedCases: string[] = [];
  for (const caseName of payload.caseNames as string[]) {
    const re = new RegExp("\\\\." + escapeRegExp(caseName) + "\\\\(");
    if (flowLines.some(line => re.test(line))) detectedCases.push(caseName);
  }

  const report = {
    elapsedMs,
    flowCount: flowLines.length,
    detectedCases,
    generatedRules: { sourceCount: sources.length, sinkCount: sinks.length, transferCount: transfers.length },
    missingCaseMethods,
  };
  console.log("ARKTAN_REPORT_JSON=" + JSON.stringify(report));
}

main();
`.trimStart();
    fs.writeFileSync(runnerPath, source, "utf-8");
    return runnerPath;
}

export function runArktanScenarioRound(
    scenario: ScenarioStaticData,
    options: CliOptions,
    runnerPath: string
): ArktanRunnerReport {
    const payloadPath = path.join(options.outputDir, `arktan_payload_${scenario.config.id}.json`);
    const payload = {
        scenarioId: scenario.config.id,
        caseNames: scenario.caseNames,
        sinkMethodName: scenario.sinkMethodName,
        transferCandidates: scenario.transferCandidates,
    };
    fs.writeFileSync(payloadPath, JSON.stringify(payload, null, 2), "utf-8");

    const ptaWorkDir = path.join(options.arktanRoot, "PointerAnalysis");
    const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;
    const cmdLine = [
        "npx",
        "ts-node",
        "-T",
        q(runnerPath),
        "--arktanRoot",
        q(options.arktanRoot),
        "--projectDir",
        q(path.resolve(scenario.config.sourceDir)),
        "--payload",
        q(payloadPath),
    ].join(" ");
    const cmd = runShellOrThrow(
        `arktan runner (scenario=${scenario.config.id})`,
        cmdLine,
        {
            cwd: ptaWorkDir,
            maxBuffer: 16 * 1024 * 1024,
        }
    );
    const stdout = cmd.stdout;
    const marker = "ARKTAN_REPORT_JSON=";
    const markerLine = stdout.split(/\r?\n/).find(line => line.startsWith(marker));
    if (!markerLine) {
        throw new Error(`arktan runner output missing marker for scenario=${scenario.config.id}`);
    }
    const json = markerLine.slice(marker.length);
    return JSON.parse(json) as ArktanRunnerReport;
}
