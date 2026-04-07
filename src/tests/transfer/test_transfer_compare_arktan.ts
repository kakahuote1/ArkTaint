import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { loadRuleSet } from "../../core/rules/RuleLoader";
import { SinkRule, SourceRule, TransferRule, normalizeEndpoint } from "../../core/rules/RuleSchema";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { runShell } from "../helpers/ProcessRunner";
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
} from "../helpers/TransferCompareTypes";
import { ensureArktanRunnerScript, runArktanScenarioRound } from "../helpers/ArktanRunnerBridge";
import { buildTransferCompareDecision, renderTransferCompareMarkdown } from "../helpers/TransferCompareReport";
import {
    createFormalTestSuite,
    TestFailureSummary,
    TestOutputMetadata,
} from "../helpers/TestOutputContract";

interface ParsedArgs {
    options: CliOptions;
    scenarioManifestPath?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
    let rounds = 5;
    let k = 1;
    let outputDir = "tmp/test_runs/compare/transfer_compare_arktan/latest";
    let kernelRulePath = "tests/rules/minimal.rules.json";
    let arktanRoot = "../Arktan";
    let runStability = false;
    let arktaintEnableProfile = true;
    let scenarioManifestPath: string | undefined;

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
        if (arg === "--kernelRule" && i + 1 < argv.length) {
            kernelRulePath = argv[++i];
            continue;
        }
        if (arg.startsWith("--kernelRule=")) {
            kernelRulePath = arg.slice("--kernelRule=".length);
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
        if (arg === "--scenarioManifest" && i + 1 < argv.length) {
            scenarioManifestPath = argv[++i];
            continue;
        }
        if (arg.startsWith("--scenarioManifest=")) {
            scenarioManifestPath = arg.slice("--scenarioManifest=".length);
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
        options: {
            rounds: Math.floor(rounds),
            k,
            outputDir: path.resolve(outputDir),
            kernelRulePath: path.resolve(kernelRulePath),
            arktanRoot: path.resolve(arktanRoot),
            runStability,
            arktaintEnableProfile,
        },
        scenarioManifestPath: scenarioManifestPath ? path.resolve(scenarioManifestPath) : undefined,
    };
}

function loadScenarioConfigs(manifestPath?: string): ScenarioConfig[] {
    if (!manifestPath) return DEFAULT_TRANSFER_COMPARE_SCENARIOS;
    if (!fs.existsSync(manifestPath)) {
        throw new Error(`scenario manifest not found: ${manifestPath}`);
    }
    const raw = fs.readFileSync(manifestPath, "utf-8").replace(/^\uFEFF/, "");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error(`scenario manifest must be a non-empty array: ${manifestPath}`);
    }

    const out: ScenarioConfig[] = [];
    for (const item of parsed) {
        const id = typeof item?.id === "string" ? item.id.trim() : "";
        const sourceDir = typeof item?.sourceDir === "string" ? item.sourceDir.trim() : "";
        const projectRulePath = typeof item?.projectRulePath === "string" ? item.projectRulePath.trim() : "";
        if (!id || !sourceDir || !projectRulePath) {
            throw new Error(`invalid scenario item in manifest: ${manifestPath}`);
        }
        out.push({ id, sourceDir, projectRulePath });
    }
    return out;
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

function flowSinkInCaseMethod(scene: Scene, sinkStmt: any, caseMethodName: string): boolean {
    const method = scene.getMethods().find(m => m.getName() === caseMethodName);
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
        const fromEndpoint = normalizeEndpoint(rule.from).endpoint;
        const toEndpoint = normalizeEndpoint(rule.to).endpoint;
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
            invokeKind: rule.match.invokeKind,
            argCount: rule.match.argCount,
            typeHint: rule.match.typeHint,
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
        kernelRulePath: options.kernelRulePath,
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
    options: CliOptions,
    progress?: {
        step: number;
        total: number;
        update(step: number, label: string, detail?: string): void;
    }
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
            if (progress) {
                progress.update(progress.step, `arktaint/${scenario.config.id}/round_${round}`, "tool=arktaint");
            }
            let roundWallMs = 0;
            let roundTransferMs = 0;
            for (const caseName of scenario.caseNames) {
                const t0 = process.hrtime.bigint();
                const engine = new TaintPropagationEngine(scenario.scene, options.k, {
                    transferRules: scenario.transferRules,
                    debug: { enableWorklistProfile: options.arktaintEnableProfile },
                });
                engine.verbose = false;
                await engine.buildPAG();
                engine.propagateWithSourceRules(scenario.sourceRules);
                const flows = engine.detectSinksByRules(scenario.sinkRules)
                    .filter(flow => flowSinkInCaseMethod(scenario.scene, flow.sink, caseName));
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
            if (progress) {
                progress.step += 1;
                progress.update(progress.step, `arktaint/${scenario.config.id}/round_${round}`, "tool=arktaint");
            }
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
    options: CliOptions,
    progress?: {
        step: number;
        total: number;
        update(step: number, label: string, detail?: string): void;
    }
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
            if (progress) {
                progress.update(progress.step, `arktan/${scenario.config.id}/round_${round}`, "tool=arktan");
            }
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
            if (progress) {
                progress.step += 1;
                progress.update(progress.step, `arktan/${scenario.config.id}/round_${round}`, "tool=arktan");
            }
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

function runStabilityChecks(
    options: CliOptions,
    progress?: {
        step: number;
        total: number;
        update(step: number, label: string, detail?: string): void;
    }
): StabilityCheck[] {
    const checks: Array<{ name: string; script: string }> = [
        { name: "verify", script: "verify" },
        { name: "smoke", script: "test:smoke" },
        { name: "generalization", script: "verify:generalization" },
    ];
    if (!options.runStability) {
        const skipped = checks.map(c => {
            if (progress) {
                progress.update(progress.step, `stability/${c.name}`, "status=skipped");
                progress.step += 1;
                progress.update(progress.step, `stability/${c.name}`, "status=skipped");
            }
            return {
                name: c.name,
                command: `npm run ${c.script}`,
                status: "skipped" as const,
                elapsedMs: 0,
                code: null,
            };
        });
        return skipped;
    }

    const out: StabilityCheck[] = [];
    for (const check of checks) {
        if (progress) {
            progress.update(progress.step, `stability/${check.name}`, `command=npm run ${check.script}`);
        }
        const t0 = process.hrtime.bigint();
        const cmd = runShell(`npm run ${check.script}`, {
            cwd: process.cwd(),
            maxBuffer: 32 * 1024 * 1024,
        });
        const dtNs = process.hrtime.bigint() - t0;
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
        if (progress) {
            progress.step += 1;
            progress.update(progress.step, `stability/${check.name}`, `status=${status}`);
        }
    }
    return out;
}

async function main(): Promise<void> {
    const parsed = parseArgs(process.argv.slice(2));
    const options = parsed.options;
    if (!fs.existsSync(options.kernelRulePath)) {
        throw new Error(`kernel rule path not found: ${options.kernelRulePath}`);
    }
    if (!fs.existsSync(options.arktanRoot)) {
        throw new Error(`arktan root not found: ${options.arktanRoot}`);
    }
    if (!fs.existsSync(path.join(options.arktanRoot, "PointerAnalysis"))) {
        throw new Error(`arktan PointerAnalysis path not found: ${path.join(options.arktanRoot, "PointerAnalysis")}`);
    }

    fs.mkdirSync(options.outputDir, { recursive: true });
    const metadata: TestOutputMetadata = {
        suite: "transfer_compare_arktan",
        domain: "compare",
        title: "Transfer Compare (ArkTaint vs Arktan)",
        purpose: "Compare ArkTaint and Arktan on transfer precision, performance, integration usability, and stability checks.",
    };
    const suite = createFormalTestSuite(options.outputDir, metadata);
    const scenarioConfigs = loadScenarioConfigs(parsed.scenarioManifestPath);
    const scenarios = scenarioConfigs.map(cfg => loadScenario(cfg, options));
    const totalSteps = (scenarios.length * options.rounds * 2) + 3;
    const progressState = {
        step: 0,
        total: totalSteps,
        update(step: number, label: string, detail?: string): void {
            progressReporter.update(step, label, detail);
        },
    };
    const progressReporter = suite.createProgress(totalSteps, {
        logEveryCount: 1,
        logEveryPercent: 5,
    });

    const arktaintReport = await runArkTaintTool(scenarios, options, progressState);
    const arktanReport = await runArktanTool(scenarios, options, progressState);

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

    const stabilityChecks = runStabilityChecks(options, progressState);
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
            ruleSchemaVersion: "2.0",
            kernelRulePath: options.kernelRulePath,
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

    suite.writeReport(report, renderTransferCompareMarkdown(report), {
        aliases: [
            {
                jsonPath: report.artifacts.jsonPath,
                markdownPath: report.artifacts.markdownPath,
            },
        ],
    });
    progressReporter.finish("DONE", "compare=transfer_compare_arktan");

    const failureItems: TestFailureSummary[] = [];
    if (!precisionPass) {
        failureItems.push({
            name: "precision_compare",
            expected: "ArkTaint fp/fn <= Arktan fp/fn",
            actual: `arktaint(fp=${arktaintReport.fp},fn=${arktaintReport.fn}) vs arktan(fp=${arktanReport.fp},fn=${arktanReport.fn})`,
            reason: precisionReason,
            severity: "high",
        });
    }
    if (!perfPass) {
        failureItems.push({
            name: "performance_compare",
            expected: "arktaint_median_transfer_ms <= arktan_median_wall_ms",
            actual: `arktaint=${(arktaintReport.medianTransferMs || 0).toFixed(3)},arktan=${arktanReport.medianWallMs.toFixed(3)}`,
            reason: perfReason,
            severity: "medium",
        });
    }
    if (!stabilityPass) {
        failureItems.push({
            name: "stability_checks",
            expected: "all stability checks pass",
            actual: stabilityReason,
            reason: "One or more stability checks failed or were skipped.",
            severity: "medium",
        });
    }
    suite.finish({
        status: report.finalDecision.pass ? "pass" : "fail",
        verdict: report.finalDecision.pass
            ? "Transfer compare completed with ArkTaint meeting the current comparison gates."
            : `Transfer compare failed: ${report.finalDecision.reason}.`,
        totals: {
            rounds: options.rounds,
            k: options.k,
            scenarios: scenarios.length,
            arktaint_fp: arktaintReport.fp,
            arktaint_fn: arktaintReport.fn,
            arktan_fp: arktanReport.fp,
            arktan_fn: arktanReport.fn,
            precision_pass: precisionPass,
            performance_pass: perfPass,
            usability_pass: usabilityPass,
            stability_pass: stabilityPass,
            final_pass: report.finalDecision.pass,
        },
        highlights: [
            `arktaint_median_transfer_ms=${(arktaintReport.medianTransferMs || 0).toFixed(3)}`,
            `arktan_median_wall_ms=${arktanReport.medianWallMs.toFixed(3)}`,
            `final_reason=${report.finalDecision.reason}`,
        ],
        failures: failureItems,
        notes: parsed.scenarioManifestPath
            ? [`scenario_manifest=${parsed.scenarioManifestPath}`]
            : undefined,
    });
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});




