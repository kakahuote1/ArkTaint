import { Scene } from "../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../core/TaintPropagationEngine";
import { loadRuleSet } from "../core/rules/RuleLoader";
import { SinkRule, SourceRule, TransferRule } from "../core/rules/RuleSchema";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { runShell } from "./helpers/ProcessRunner";
import {
    CaseResult,
    CliOptions,
    CompareReport,
    DEFAULT_INTEGRATION_STEPS,
    DEFAULT_TRANSFER_COMPARE_SCENARIOS,
    RoundTiming,
    ScenarioConfig,
    ScenarioRunReport,
    ScenarioStaticData,
    StabilityCheck,
    TransferCandidate,
    ToolReport,
} from "./helpers/TransferCompareTypes";
import { ensureArktanRunnerScript, runArktanScenarioRound } from "./helpers/ArktanRunnerBridge";
import { buildTransferCompareDecision, renderTransferCompareMarkdown } from "./helpers/TransferCompareReport";

function parseArgs(argv: string[]): CliOptions {
    let rounds = 5;
    let k = 1;
    let outputDir = "tmp/phase55";
    let defaultRulePath = "tests/rules/minimal.rules.json";
    let arktanRoot = "../Arktan";
    let runStability = false;
    let arktaintEnableProfile = true;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--rounds" && i + 1 < argv.length) {
            rounds = Number(argv[++i]);
            continue;
        }
        if (arg.startsWith("--rounds=")) {
            rounds = Number(arg.slice("--rounds=".length));
            continue;
        }
        if (arg === "--k" && i + 1 < argv.length) {
            k = Number(argv[++i]);
            continue;
        }
        if (arg.startsWith("--k=")) {
            k = Number(arg.slice("--k=".length));
            continue;
        }
        if (arg === "--outputDir" && i + 1 < argv.length) {
            outputDir = argv[++i];
            continue;
        }
        if (arg.startsWith("--outputDir=")) {
            outputDir = arg.slice("--outputDir=".length);
            continue;
        }
        if (arg === "--default" && i + 1 < argv.length) {
            defaultRulePath = argv[++i];
            continue;
        }
        if (arg.startsWith("--default=")) {
            defaultRulePath = arg.slice("--default=".length);
            continue;
        }
        if (arg === "--arktanRoot" && i + 1 < argv.length) {
            arktanRoot = argv[++i];
            continue;
        }
        if (arg.startsWith("--arktanRoot=")) {
            arktanRoot = arg.slice("--arktanRoot=".length);
            continue;
        }
        if (arg === "--runStability") {
            runStability = true;
            continue;
        }
        if (arg === "--arktaintNoProfile") {
            arktaintEnableProfile = false;
            continue;
        }
    }

    if (!Number.isFinite(rounds) || rounds <= 0) {
        throw new Error(`invalid --rounds: ${rounds}`);
    }
    if (k !== 0 && k !== 1) {
        throw new Error(`invalid --k: ${k}`);
    }

    return {
        rounds: Math.floor(rounds),
        k,
        outputDir: path.resolve(outputDir),
        defaultRulePath: path.resolve(defaultRulePath),
        arktanRoot: path.resolve(arktanRoot),
        runStability,
        arktaintEnableProfile,
    };
}

function median(nums: number[]): number {
    if (nums.length === 0) return 0;
    const sorted = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
        return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
}

function listCaseNames(sourceDir: string): string[] {
    return fs.readdirSync(sourceDir)
        .filter(f => f.endsWith(".ets"))
        .map(f => path.basename(f, ".ets"))
        .filter(name => name !== "taint_mock")
        .sort();
}

function expectedFromCaseName(caseName: string): boolean {
    return caseName.endsWith("_T");
}

function flowSinkInEntryMethod(scene: Scene, sinkStmt: any, entryMethodName: string): boolean {
    const method = scene.getMethods().find(m => m.getName() === entryMethodName);
    if (!method) return false;
    const cfg = method.getCfg();
    if (!cfg) return false;
    return cfg.getStmts().includes(sinkStmt);
}

function parseEndpoint(endpoint: string): string | null {
    if (endpoint === "base" || endpoint === "result") {
        return endpoint;
    }
    if (/^arg\d+$/.test(endpoint)) {
        return String(Number(endpoint.slice(3)));
    }
    return null;
}

function toTransferCandidates(transferRules: TransferRule[]): {
    candidates: TransferCandidate[];
    dropped: Array<{ id: string; reason: string }>;
} {
    const candidates: TransferCandidate[] = [];
    const dropped: Array<{ id: string; reason: string }> = [];
    for (const rule of transferRules) {
        const id = rule.id || "transfer.unknown";
        if (!rule.match || !rule.match.kind || !rule.match.value) {
            dropped.push({ id, reason: "unsupported_match_kind" });
            continue;
        }
        const fromEndpoint = rule.fromRef?.endpoint || rule.from;
        const toEndpoint = rule.toRef?.endpoint || rule.to;
        const from = parseEndpoint(String(fromEndpoint));
        const to = parseEndpoint(String(toEndpoint));
        if (!from || !to) {
            dropped.push({ id, reason: "unsupported_endpoint" });
            continue;
        }
        candidates.push({
            id,
            matchKind: String(rule.match.kind),
            matchValue: String(rule.match.value),
            invokeKind: rule.invokeKind,
            argCount: rule.argCount,
            typeHint: rule.typeHint,
            scope: rule.scope as unknown as Record<string, unknown> | undefined,
            from,
            to,
        });
    }
    return { candidates, dropped };
}

function pickSinkMethodName(sinkRules: SinkRule[]): string {
    for (const rule of sinkRules) {
        if (rule.match?.kind === "method_name_equals" && rule.match.value) {
            return String(rule.match.value);
        }
    }
    return "Sink";
}

function loadScenario(config: ScenarioConfig, options: CliOptions): ScenarioStaticData {
    const sourceDirAbs = path.resolve(config.sourceDir);
    const projectRulePathAbs = path.resolve(config.projectRulePath);
    if (!fs.existsSync(sourceDirAbs)) {
        throw new Error(`scenario sourceDir not found: ${sourceDirAbs}`);
    }
    if (!fs.existsSync(projectRulePathAbs)) {
        throw new Error(`scenario projectRulePath not found: ${projectRulePathAbs}`);
    }

    const loaded = loadRuleSet({
        defaultRulePath: options.defaultRulePath,
        projectRulePath: projectRulePathAbs,
        autoDiscoverLayers: false,
    });

    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(sourceDirAbs);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(sceneConfig);
    scene.inferTypes();

    const transferParsing = toTransferCandidates(loaded.ruleSet.transfers || []);
    const sinkMethodName = pickSinkMethodName(loaded.ruleSet.sinks || []);

    return {
        config,
        scene,
        caseNames: listCaseNames(sourceDirAbs),
        sourceRules: loaded.ruleSet.sources || [],
        sinkRules: loaded.ruleSet.sinks || [],
        transferRules: loaded.ruleSet.transfers || [],
        transferCandidates: transferParsing.candidates,
        droppedTransferRules: transferParsing.dropped,
        sinkMethodName,
    };
}

async function runArkTaintTool(
    scenarios: ScenarioStaticData[],
    options: CliOptions
): Promise<ToolReport> {
    const perScenario: ScenarioRunReport[] = [];
    const allRoundWall: number[] = [];
    const allRoundTransfer: number[] = [];
    let totalCases = 0;
    let passCases = 0;
    let fp = 0;
    let fn = 0;

    for (const scenario of scenarios) {
        const detections = new Map<string, boolean>();
        const rounds: RoundTiming[] = [];
        for (let round = 1; round <= options.rounds; round++) {
            let roundWallMs = 0;
            let roundTransferMs = 0;
            for (const caseName of scenario.caseNames) {
                const t0 = process.hrtime.bigint();
                const engine = new TaintPropagationEngine(scenario.scene, options.k, {
                    transferRules: scenario.transferRules,
                    debug: { enableWorklistProfile: options.arktaintEnableProfile },
                });
                engine.verbose = false;
                await engine.buildPAG(caseName);
                engine.propagateWithSourceRules(scenario.sourceRules, { entryMethodName: caseName });
                const flows = engine.detectSinksByRules(scenario.sinkRules)
                    .filter(flow => flowSinkInEntryMethod(scenario.scene, flow.sink, caseName));
                const detected = flows.length > 0;
                const old = detections.get(caseName);
                if (old === undefined) {
                    detections.set(caseName, detected);
                } else if (old !== detected) {
                    throw new Error(`arktaint detection drift: scenario=${scenario.config.id}, case=${caseName}, round=${round}`);
                }
                const transferElapsed = options.arktaintEnableProfile
                    ? (engine.getWorklistProfile()?.transfer?.elapsedMs || 0)
                    : 0;
                const dtNs = process.hrtime.bigint() - t0;
                roundWallMs += Number(dtNs) / 1_000_000;
                roundTransferMs += transferElapsed;
            }
            rounds.push({
                round,
                wallElapsedMs: roundWallMs,
                transferElapsedMs: roundTransferMs,
            });
            allRoundWall.push(roundWallMs);
            allRoundTransfer.push(roundTransferMs);
        }

        const caseResults: CaseResult[] = scenario.caseNames.map(caseName => {
            const expected = expectedFromCaseName(caseName);
            const detected = detections.get(caseName) || false;
            const pass = detected === expected;
            return { caseName, expected, detected, pass };
        });
        const scenarioPass = caseResults.filter(r => r.pass).length;
        const scenarioFp = caseResults.filter(r => !r.expected && r.detected).length;
        const scenarioFn = caseResults.filter(r => r.expected && !r.detected).length;
        totalCases += caseResults.length;
        passCases += scenarioPass;
        fp += scenarioFp;
        fn += scenarioFn;

        perScenario.push({
            scenarioId: scenario.config.id,
            totalCases: caseResults.length,
            passCases: scenarioPass,
            fp: scenarioFp,
            fn: scenarioFn,
            caseResults,
            rounds,
            metadata: {
                droppedTransferRulesForArktan: scenario.droppedTransferRules.length,
            },
        });
    }

    return {
        tool: "arktaint",
        totalCases,
        passCases,
        fp,
        fn,
        perScenario,
        medianWallMs: median(allRoundWall),
        medianTransferMs: median(allRoundTransfer),
    };
}

async function runArktanTool(
    scenarios: ScenarioStaticData[],
    options: CliOptions
): Promise<ToolReport> {
    const perScenario: ScenarioRunReport[] = [];
    const allRoundWall: number[] = [];
    let totalCases = 0;
    let passCases = 0;
    let fp = 0;
    let fn = 0;
    const runnerPath = ensureArktanRunnerScript(options.outputDir);

    for (const scenario of scenarios) {
        const detections = new Map<string, boolean>();
        const rounds: RoundTiming[] = [];
        let lastMetadata: Record<string, unknown> = {};
        for (let round = 1; round <= options.rounds; round++) {
            const result = runArktanScenarioRound(scenario, options, runnerPath);
            const detectedSet = new Set(result.detectedCases);
            for (const caseName of scenario.caseNames) {
                const detected = detectedSet.has(caseName);
                const old = detections.get(caseName);
                if (old === undefined) {
                    detections.set(caseName, detected);
                } else if (old !== detected) {
                    throw new Error(`arktan detection drift: scenario=${scenario.config.id}, case=${caseName}, round=${round}`);
                }
            }
            rounds.push({
                round,
                wallElapsedMs: result.elapsedMs,
            });
            allRoundWall.push(result.elapsedMs);
            lastMetadata = {
                flowCount: result.flowCount,
                generatedRules: result.generatedRules,
                missingCaseMethods: result.missingCaseMethods,
                droppedTransferRules: scenario.droppedTransferRules.length,
            };
        }

        const caseResults: CaseResult[] = scenario.caseNames.map(caseName => {
            const expected = expectedFromCaseName(caseName);
            const detected = detections.get(caseName) || false;
            const pass = detected === expected;
            return { caseName, expected, detected, pass };
        });
        const scenarioPass = caseResults.filter(r => r.pass).length;
        const scenarioFp = caseResults.filter(r => !r.expected && r.detected).length;
        const scenarioFn = caseResults.filter(r => r.expected && !r.detected).length;
        totalCases += caseResults.length;
        passCases += scenarioPass;
        fp += scenarioFp;
        fn += scenarioFn;

        perScenario.push({
            scenarioId: scenario.config.id,
            totalCases: caseResults.length,
            passCases: scenarioPass,
            fp: scenarioFp,
            fn: scenarioFn,
            caseResults,
            rounds,
            metadata: lastMetadata,
        });
    }

    return {
        tool: "arktan",
        totalCases,
        passCases,
        fp,
        fn,
        perScenario,
        medianWallMs: median(allRoundWall),
    };
}

function runStabilityChecks(options: CliOptions): StabilityCheck[] {
    const checks: Array<{ name: string; script: string }> = [
        { name: "verify", script: "verify" },
        { name: "smoke", script: "test:smoke" },
        { name: "generalization", script: "verify:generalization" },
    ];
    if (!options.runStability) {
        return checks.map(c => ({
            name: c.name,
            command: `npm run ${c.script}`,
            status: "skipped",
            elapsedMs: 0,
            code: null,
        }));
    }

    const out: StabilityCheck[] = [];
    for (const check of checks) {
        const t0 = process.hrtime.bigint();
        const dtNs = process.hrtime.bigint() - t0;
        const cmd = runShell(`npm run ${check.script}`, {
            cwd: process.cwd(),
            maxBuffer: 32 * 1024 * 1024,
        });
        const status = (!cmd.errorMessage && cmd.status === 0)
            ? "pass"
            : "fail";
        out.push({
            name: check.name,
            command: `npm run ${check.script}`,
            status,
            elapsedMs: Number(dtNs) / 1_000_000,
            code: cmd.status,
        });
    }
    return out;
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    if (!fs.existsSync(options.defaultRulePath)) {
        throw new Error(`default rule path not found: ${options.defaultRulePath}`);
    }
    if (!fs.existsSync(options.arktanRoot)) {
        throw new Error(`arktan root not found: ${options.arktanRoot}`);
    }
    if (!fs.existsSync(path.join(options.arktanRoot, "PointerAnalysis"))) {
        throw new Error(`arktan PointerAnalysis path not found: ${path.join(options.arktanRoot, "PointerAnalysis")}`);
    }

    fs.mkdirSync(options.outputDir, { recursive: true });
    const scenarios = DEFAULT_TRANSFER_COMPARE_SCENARIOS.map(cfg => loadScenario(cfg, options));

    const arktaintReport = await runArkTaintTool(scenarios, options);
    const arktanReport = await runArktanTool(scenarios, options);

    const precisionPass = arktaintReport.fp <= arktanReport.fp && arktaintReport.fn <= arktanReport.fn;
    const precisionReason = precisionPass
        ? "ok"
        : `fp_fn_compare_failed(arktaint_fp=${arktaintReport.fp},arktaint_fn=${arktaintReport.fn},arktan_fp=${arktanReport.fp},arktan_fn=${arktanReport.fn})`;

    const perfPass = (arktaintReport.medianTransferMs || 0) <= arktanReport.medianWallMs;
    const perfReason = perfPass
        ? "ok"
        : `arktaint_transfer_median_gt_arktan_wall_median(arktaint=${(arktaintReport.medianTransferMs || 0).toFixed(3)},arktan=${arktanReport.medianWallMs.toFixed(3)})`;

    const integrationSteps = DEFAULT_INTEGRATION_STEPS;
    const usabilityPass = integrationSteps.length <= 3;
    const usabilityReason = usabilityPass ? "ok" : "integration_steps_exceeds_3";

    const stabilityChecks = runStabilityChecks(options);
    const stabilityPass = stabilityChecks.every(c => c.status === "pass");
    const stabilityReason = stabilityPass
        ? "ok"
        : stabilityChecks.some(c => c.status === "skipped")
            ? "stability_checks_skipped"
            : "stability_check_failed";

    const report: CompareReport = {
        generatedAt: new Date().toISOString(),
        options: {
            rounds: options.rounds,
            k: options.k,
            ruleSchemaVersion: "1.1",
            defaultRulePath: options.defaultRulePath,
            arktanRoot: options.arktanRoot,
            runStability: options.runStability,
        },
        environment: {
            node: process.version,
            platform: `${process.platform}-${process.arch}`,
            cpus: os.cpus()?.length || 0,
            host: os.hostname(),
        },
        scenarios: scenarios.map(s => ({
            id: s.config.id,
            sourceDir: path.resolve(s.config.sourceDir),
            projectRulePath: path.resolve(s.config.projectRulePath),
            caseCount: s.caseNames.length,
            droppedTransferRules: s.droppedTransferRules.length,
        })),
        precision: {
            arktaint: { fp: arktaintReport.fp, fn: arktaintReport.fn },
            arktan: { fp: arktanReport.fp, fn: arktanReport.fn },
            pass: precisionPass,
            reason: precisionReason,
        },
        performance: {
            arktaintMedianTransferMs: arktaintReport.medianTransferMs || 0,
            arktaintMedianWallMs: arktaintReport.medianWallMs,
            arktanMedianWallMs: arktanReport.medianWallMs,
            pass: perfPass,
            reason: perfReason,
        },
        usability: {
            integrationSteps,
            stepCount: integrationSteps.length,
            pass: usabilityPass,
            reason: usabilityReason,
        },
        stability: {
            checks: stabilityChecks,
            pass: stabilityPass,
            reason: stabilityReason,
        },
        artifacts: {
            jsonPath: path.resolve(options.outputDir, "compare_report.json"),
            markdownPath: path.resolve(options.outputDir, "compare_report.md"),
        },
        details: {
            arktaint: arktaintReport,
            arktan: arktanReport,
        },
        finalDecision: { pass: false, reason: "pending" },
    };
    report.finalDecision = buildTransferCompareDecision(report);

    fs.writeFileSync(report.artifacts.jsonPath, JSON.stringify(report, null, 2), "utf-8");
    fs.writeFileSync(report.artifacts.markdownPath, renderTransferCompareMarkdown(report), "utf-8");

    console.log("====== Transfer Compare (ArkTaint vs Arktan) ======");
    console.log(`rounds=${options.rounds}`);
    console.log(`k=${options.k}`);
    console.log(`arktaint_fp=${arktaintReport.fp}`);
    console.log(`arktaint_fn=${arktaintReport.fn}`);
    console.log(`arktan_fp=${arktanReport.fp}`);
    console.log(`arktan_fn=${arktanReport.fn}`);
    console.log(`precision_pass=${precisionPass}`);
    console.log(`arktaint_median_transfer_ms=${(arktaintReport.medianTransferMs || 0).toFixed(3)}`);
    console.log(`arktaint_median_wall_ms=${arktaintReport.medianWallMs.toFixed(3)}`);
    console.log(`arktan_median_wall_ms=${arktanReport.medianWallMs.toFixed(3)}`);
    console.log(`performance_pass=${perfPass}`);
    console.log(`usability_pass=${usabilityPass}`);
    console.log(`stability_pass=${stabilityPass}`);
    console.log(`final_pass=${report.finalDecision.pass}`);
    console.log(`final_reason=${report.finalDecision.reason}`);
    console.log(`report_json=${report.artifacts.jsonPath}`);
    console.log(`report_md=${report.artifacts.markdownPath}`);

    if (!report.finalDecision.pass) {
        process.exitCode = 1;
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
