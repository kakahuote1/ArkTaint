import { Scene } from "../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../core/TaintPropagationEngine";
import { loadRuleSet } from "../core/rules/RuleLoader";
import { SinkRule, SourceRule, TransferRule } from "../core/rules/RuleSchema";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

type PerfMode = "baseline" | "optimized";

interface CliOptions {
    rounds: number;
    threshold: number;
    noiseRules: number;
    outputDir: string;
    k: number;
    defaultRulePath: string;
}

interface ScenarioConfig {
    id: string;
    sourceDir: string;
    projectRulePath: string;
}

interface ScenarioRuntime {
    config: ScenarioConfig;
    scene: Scene;
    caseNames: string[];
    sourceRules: SourceRule[];
    sinkRules: SinkRule[];
    transferRules: TransferRule[];
}

interface RoundStats {
    mode: PerfMode;
    round: number;
    transferElapsedMs: number;
    wallElapsedMs: number;
    factCount: number;
    invokeSiteCount: number;
    ruleCheckCount: number;
    ruleMatchCount: number;
    endpointCheckCount: number;
    endpointMatchCount: number;
    dedupSkipCount: number;
    resultCount: number;
    failCaseCount: number;
}

interface BenchmarkReport {
    generatedAt: string;
    options: {
        rounds: number;
        threshold: number;
        noiseRules: number;
        k: number;
    };
    environment: {
        node: string;
        platform: string;
        cpus: number;
    };
    scenarios: ScenarioConfig[];
    baseline: {
        rounds: RoundStats[];
        medianTransferMs: number;
        medianWallMs: number;
    };
    optimized: {
        rounds: RoundStats[];
        medianTransferMs: number;
        medianWallMs: number;
    };
    comparison: {
        transferReductionRatio: number;
        wallReductionRatio: number;
        pass: boolean;
        reason: string;
    };
    artifacts: {
        jsonPath: string;
        markdownPath: string;
    };
}

function parseArgs(argv: string[]): CliOptions {
    let rounds = 5;
    let threshold = 0.3;
    let noiseRules = 400;
    let outputDir = "tmp/phase54d/transfer_perf_benchmark";
    let k = 1;
    let defaultRulePath = "tests/rules/minimal.rules.json";

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
        if (arg === "--threshold" && i + 1 < argv.length) {
            threshold = Number(argv[++i]);
            continue;
        }
        if (arg.startsWith("--threshold=")) {
            threshold = Number(arg.slice("--threshold=".length));
            continue;
        }
        if (arg === "--noiseRules" && i + 1 < argv.length) {
            noiseRules = Number(argv[++i]);
            continue;
        }
        if (arg.startsWith("--noiseRules=")) {
            noiseRules = Number(arg.slice("--noiseRules=".length));
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
        if (arg === "--k" && i + 1 < argv.length) {
            k = Number(argv[++i]);
            continue;
        }
        if (arg.startsWith("--k=")) {
            k = Number(arg.slice("--k=".length));
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
    }

    if (!Number.isFinite(rounds) || rounds <= 0) {
        throw new Error(`invalid --rounds: ${rounds}`);
    }
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
        throw new Error(`invalid --threshold: ${threshold}`);
    }
    if (!Number.isFinite(noiseRules) || noiseRules < 0) {
        throw new Error(`invalid --noiseRules: ${noiseRules}`);
    }
    if (k !== 0 && k !== 1) {
        throw new Error(`invalid --k: ${k}`);
    }

    return {
        rounds: Math.floor(rounds),
        threshold,
        noiseRules: Math.floor(noiseRules),
        outputDir: path.resolve(outputDir),
        k,
        defaultRulePath: path.resolve(defaultRulePath),
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
        .sort();
}

function flowSinkInEntryMethod(scene: Scene, sinkStmt: any, entryMethodName: string): boolean {
    const method = scene.getMethods().find(m => m.getName() === entryMethodName);
    if (!method) return false;
    const cfg = method.getCfg();
    if (!cfg) return false;
    return cfg.getStmts().includes(sinkStmt);
}

function createNoiseTransferRules(count: number): TransferRule[] {
    const out: TransferRule[] = [];
    for (let i = 0; i < count; i++) {
        out.push({
            id: `transfer.noise.${i + 1}`,
            enabled: true,
            match: {
                kind: "method_name_equals",
                value: `__NoiseMethod_${i + 1}__`,
            },
            from: "arg0",
            to: "result",
        });
    }
    return out;
}

function loadScenario(config: ScenarioConfig, options: CliOptions): ScenarioRuntime {
    const sourceDirAbs = path.resolve(config.sourceDir);
    const projectRulePathAbs = path.resolve(config.projectRulePath);
    if (!fs.existsSync(sourceDirAbs)) {
        throw new Error(`scenario sourceDir not found: ${sourceDirAbs}`);
    }
    if (!fs.existsSync(projectRulePathAbs)) {
        throw new Error(`scenario rule not found: ${projectRulePathAbs}`);
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

    return {
        config,
        scene,
        caseNames: listCaseNames(sourceDirAbs).filter(n => n !== "taint_mock"),
        sourceRules: loaded.ruleSet.sources || [],
        sinkRules: loaded.ruleSet.sinks || [],
        transferRules: loaded.ruleSet.transfers || [],
    };
}

async function runRound(
    mode: PerfMode,
    round: number,
    scenarios: ScenarioRuntime[],
    options: CliOptions,
    noiseRules: TransferRule[]
): Promise<RoundStats> {
    process.env.ARKTAINT_TRANSFER_PERF_MODE = mode;
    const t0 = process.hrtime.bigint();
    const stats: RoundStats = {
        mode,
        round,
        transferElapsedMs: 0,
        wallElapsedMs: 0,
        factCount: 0,
        invokeSiteCount: 0,
        ruleCheckCount: 0,
        ruleMatchCount: 0,
        endpointCheckCount: 0,
        endpointMatchCount: 0,
        dedupSkipCount: 0,
        resultCount: 0,
        failCaseCount: 0,
    };

    for (const scenario of scenarios) {
        const transferRules = noiseRules.length > 0
            ? [...scenario.transferRules, ...noiseRules]
            : scenario.transferRules;
        for (const caseName of scenario.caseNames) {
            const expected = caseName.endsWith("_T");
            const engine = new TaintPropagationEngine(scenario.scene, options.k, {
                transferRules,
                debug: { enableWorklistProfile: true },
            });
            engine.verbose = false;
            await engine.buildPAG(caseName);
            engine.propagateWithSourceRules(scenario.sourceRules, { entryMethodName: caseName });
            const flows = engine.detectSinksByRules(scenario.sinkRules)
                .filter(flow => flowSinkInEntryMethod(scenario.scene, flow.sink, caseName));
            const detected = flows.length > 0;
            if (detected !== expected) {
                stats.failCaseCount++;
            }

            const transferProfile = engine.getWorklistProfile()?.transfer;
            if (transferProfile) {
                stats.transferElapsedMs += transferProfile.elapsedMs;
                stats.factCount += transferProfile.factCount;
                stats.invokeSiteCount += transferProfile.invokeSiteCount;
                stats.ruleCheckCount += transferProfile.ruleCheckCount;
                stats.ruleMatchCount += transferProfile.ruleMatchCount;
                stats.endpointCheckCount += transferProfile.endpointCheckCount;
                stats.endpointMatchCount += transferProfile.endpointMatchCount;
                stats.dedupSkipCount += transferProfile.dedupSkipCount;
                stats.resultCount += transferProfile.resultCount;
            }
        }
    }

    const dtNs = process.hrtime.bigint() - t0;
    stats.wallElapsedMs = Number(dtNs) / 1_000_000;
    return stats;
}

function renderMarkdown(report: BenchmarkReport): string {
    const lines: string[] = [];
    lines.push("# Phase 5.4 Step D Transfer Perf Benchmark");
    lines.push("");
    lines.push(`- generatedAt: ${report.generatedAt}`);
    lines.push(`- rounds: ${report.options.rounds}`);
    lines.push(`- noiseRules: ${report.options.noiseRules}`);
    lines.push(`- threshold: ${report.options.threshold}`);
    lines.push(`- k: ${report.options.k}`);
    lines.push(`- environment: node=${report.environment.node}, platform=${report.environment.platform}, cpus=${report.environment.cpus}`);
    lines.push(`- baseline median transfer ms: ${report.baseline.medianTransferMs.toFixed(3)}`);
    lines.push(`- optimized median transfer ms: ${report.optimized.medianTransferMs.toFixed(3)}`);
    lines.push(`- transfer reduction ratio: ${(report.comparison.transferReductionRatio * 100).toFixed(2)}%`);
    lines.push(`- baseline median wall ms: ${report.baseline.medianWallMs.toFixed(3)}`);
    lines.push(`- optimized median wall ms: ${report.optimized.medianWallMs.toFixed(3)}`);
    lines.push(`- wall reduction ratio: ${(report.comparison.wallReductionRatio * 100).toFixed(2)}%`);
    lines.push(`- pass: ${report.comparison.pass}`);
    lines.push(`- reason: ${report.comparison.reason}`);
    lines.push("");
    lines.push("## Scenarios");
    for (const s of report.scenarios) {
        lines.push(`- ${s.id}: sourceDir=${s.sourceDir}, rules=${s.projectRulePath}`);
    }
    return lines.join("\n");
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    if (!fs.existsSync(options.defaultRulePath)) {
        throw new Error(`default rule path not found: ${options.defaultRulePath}`);
    }

    const scenarios: ScenarioConfig[] = [
        {
            id: "rule_precision_transfer",
            sourceDir: "tests/demo/rule_precision_transfer",
            projectRulePath: "tests/rules/transfer_precision.rules.json",
        },
        {
            id: "transfer_overload_conflicts",
            sourceDir: "tests/demo/transfer_overload_conflicts",
            projectRulePath: "tests/rules/transfer_overload_conflicts.rules.json",
        },
        {
            id: "transfer_priority",
            sourceDir: "tests/demo/transfer_priority",
            projectRulePath: "tests/rules/transfer_priority.rules.json",
        },
    ];

    const runtimeScenarios = scenarios.map(s => loadScenario(s, options));
    const noiseRules = createNoiseTransferRules(options.noiseRules);

    const baselineRounds: RoundStats[] = [];
    const optimizedRounds: RoundStats[] = [];
    const oldMode = process.env.ARKTAINT_TRANSFER_PERF_MODE;
    try {
        for (let round = 1; round <= options.rounds; round++) {
            baselineRounds.push(await runRound("baseline", round, runtimeScenarios, options, noiseRules));
        }
        for (let round = 1; round <= options.rounds; round++) {
            optimizedRounds.push(await runRound("optimized", round, runtimeScenarios, options, noiseRules));
        }
    } finally {
        if (oldMode === undefined) {
            delete process.env.ARKTAINT_TRANSFER_PERF_MODE;
        } else {
            process.env.ARKTAINT_TRANSFER_PERF_MODE = oldMode;
        }
    }

    const baselineMedianTransferMs = median(baselineRounds.map(r => r.transferElapsedMs));
    const optimizedMedianTransferMs = median(optimizedRounds.map(r => r.transferElapsedMs));
    const baselineMedianWallMs = median(baselineRounds.map(r => r.wallElapsedMs));
    const optimizedMedianWallMs = median(optimizedRounds.map(r => r.wallElapsedMs));
    const transferReductionRatio = baselineMedianTransferMs > 0
        ? (baselineMedianTransferMs - optimizedMedianTransferMs) / baselineMedianTransferMs
        : 0;
    const wallReductionRatio = baselineMedianWallMs > 0
        ? (baselineMedianWallMs - optimizedMedianWallMs) / baselineMedianWallMs
        : 0;

    const failCases = baselineRounds.reduce((a, r) => a + r.failCaseCount, 0)
        + optimizedRounds.reduce((a, r) => a + r.failCaseCount, 0);
    const pass = failCases === 0 && transferReductionRatio >= options.threshold;
    const reason = failCases > 0
        ? `semantic_mismatch_detected=${failCases}`
        : transferReductionRatio < options.threshold
            ? `transfer_reduction_${(transferReductionRatio * 100).toFixed(2)}%_below_threshold_${(options.threshold * 100).toFixed(2)}%`
            : "ok";

    fs.mkdirSync(options.outputDir, { recursive: true });
    const jsonPath = path.resolve(options.outputDir, "transfer_perf_benchmark_report.json");
    const markdownPath = path.resolve(options.outputDir, "transfer_perf_benchmark_report.md");
    const report: BenchmarkReport = {
        generatedAt: new Date().toISOString(),
        options: {
            rounds: options.rounds,
            threshold: options.threshold,
            noiseRules: options.noiseRules,
            k: options.k,
        },
        environment: {
            node: process.version,
            platform: `${process.platform}-${process.arch}`,
            cpus: os.cpus()?.length || 0,
        },
        scenarios,
        baseline: {
            rounds: baselineRounds,
            medianTransferMs: baselineMedianTransferMs,
            medianWallMs: baselineMedianWallMs,
        },
        optimized: {
            rounds: optimizedRounds,
            medianTransferMs: optimizedMedianTransferMs,
            medianWallMs: optimizedMedianWallMs,
        },
        comparison: {
            transferReductionRatio,
            wallReductionRatio,
            pass,
            reason,
        },
        artifacts: {
            jsonPath,
            markdownPath,
        },
    };

    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf-8");
    fs.writeFileSync(markdownPath, renderMarkdown(report), "utf-8");

    console.log("====== Transfer Perf Benchmark ======");
    console.log(`rounds=${options.rounds}`);
    console.log(`noise_rules=${options.noiseRules}`);
    console.log(`baseline_median_transfer_ms=${baselineMedianTransferMs.toFixed(3)}`);
    console.log(`optimized_median_transfer_ms=${optimizedMedianTransferMs.toFixed(3)}`);
    console.log(`transfer_reduction_ratio=${transferReductionRatio.toFixed(4)}`);
    console.log(`baseline_median_wall_ms=${baselineMedianWallMs.toFixed(3)}`);
    console.log(`optimized_median_wall_ms=${optimizedMedianWallMs.toFixed(3)}`);
    console.log(`wall_reduction_ratio=${wallReductionRatio.toFixed(4)}`);
    console.log(`semantic_fail_cases=${failCases}`);
    console.log(`threshold=${options.threshold}`);
    console.log(`pass=${pass}`);
    console.log(`reason=${reason}`);
    console.log(`report_json=${jsonPath}`);
    console.log(`report_md=${markdownPath}`);

    if (!pass) {
        process.exitCode = 1;
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});

