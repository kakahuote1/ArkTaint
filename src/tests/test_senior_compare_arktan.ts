import { Scene } from "../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../arkanalyzer/out/src/Config";
import { ArkAssignStmt } from "../../arkanalyzer/out/src/core/base/Stmt";
import { ArkParameterRef } from "../../arkanalyzer/out/src/core/base/Ref";
import { Local } from "../../arkanalyzer/out/src/core/base/Local";
import { TaintPropagationEngine } from "../core/TaintPropagationEngine";
import { ArktanCaseSpec, ensureArktanRunnerScript, runArktanCaseSetRound } from "./helpers/ArktanRunnerBridge";
import * as fs from "fs";
import * as path from "path";

type CompareMode = "strict" | "default";

interface ParsedArgs {
    sourceRoot: string;
    arktanRoot: string;
    outputDir: string;
    rounds: number;
    k: number;
    mode: CompareMode;
    includeRegex?: RegExp;
    maxScenarios?: number;
}

interface CaseSpec {
    caseId: string;
    relativeFile: string;
    caseMethodName: string;
    expected: boolean;
}

interface ScenarioSpec {
    id: string;
    sourceDir: string;
    sourceDirRel: string;
    scene: Scene;
    cases: CaseSpec[];
}

interface CaseResult {
    caseId: string;
    caseMethodName: string;
    expected: boolean;
    arktaintDetected: boolean;
    arktanDetected: boolean;
}

interface ScenarioReport {
    scenarioId: string;
    sourceDir: string;
    totalCases: number;
    arktaintPassCases: number;
    arktanPassCases: number;
    arktaintFp: number;
    arktaintFn: number;
    arktanFp: number;
    arktanFn: number;
    arktanMissingCaseMethods: string[];
    arktaintError?: string;
    arktanError?: string;
    caseResults: CaseResult[];
}

interface SummaryReport {
    generatedAt: string;
    mode: CompareMode;
    sourceRoot: string;
    arktanRoot: string;
    rounds: number;
    k: number;
    scenarioCount: number;
    totalCases: number;
    arktaint: {
        passCases: number;
        fp: number;
        fn: number;
    };
    arktan: {
        passCases: number;
        fp: number;
        fn: number;
    };
    scenarios: ScenarioReport[];
}

function parseArgs(argv: string[]): ParsedArgs {
    let sourceRoot = "tests/demo/senior_full";
    let arktanRoot = "../Arktan";
    let outputDir = "tmp/senior_compare_arktan";
    let rounds = 1;
    let k = 1;
    let mode: CompareMode = "strict";
    let includeRegex: RegExp | undefined;
    let maxScenarios: number | undefined;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--sourceRoot" && i + 1 < argv.length) {
            sourceRoot = argv[++i];
            continue;
        }
        if (arg.startsWith("--sourceRoot=")) {
            sourceRoot = arg.slice("--sourceRoot=".length);
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
        if (arg === "--outputDir" && i + 1 < argv.length) {
            outputDir = argv[++i];
            continue;
        }
        if (arg.startsWith("--outputDir=")) {
            outputDir = arg.slice("--outputDir=".length);
            continue;
        }
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
        if (arg === "--mode" && i + 1 < argv.length) {
            mode = argv[++i] === "default" ? "default" : "strict";
            continue;
        }
        if (arg.startsWith("--mode=")) {
            mode = arg.slice("--mode=".length) === "default" ? "default" : "strict";
            continue;
        }
        if (arg === "--includeRegex" && i + 1 < argv.length) {
            includeRegex = new RegExp(argv[++i]);
            continue;
        }
        if (arg.startsWith("--includeRegex=")) {
            includeRegex = new RegExp(arg.slice("--includeRegex=".length));
            continue;
        }
        if (arg === "--maxScenarios" && i + 1 < argv.length) {
            maxScenarios = Number(argv[++i]);
            continue;
        }
        if (arg.startsWith("--maxScenarios=")) {
            maxScenarios = Number(arg.slice("--maxScenarios=".length));
            continue;
        }
    }

    if (!Number.isFinite(rounds) || rounds <= 0) {
        throw new Error(`invalid --rounds: ${rounds}`);
    }
    if (k !== 0 && k !== 1) {
        throw new Error(`invalid --k: ${k}`);
    }
    if (maxScenarios !== undefined && (!Number.isFinite(maxScenarios) || maxScenarios <= 0)) {
        throw new Error(`invalid --maxScenarios: ${maxScenarios}`);
    }

    return {
        sourceRoot: path.resolve(sourceRoot),
        arktanRoot: path.resolve(arktanRoot),
        outputDir: path.resolve(outputDir),
        rounds: Math.floor(rounds),
        k,
        mode,
        includeRegex,
        maxScenarios: maxScenarios ? Math.floor(maxScenarios) : undefined,
    };
}

function isCaseFile(fileName: string): boolean {
    return fileName.endsWith(".ets");
}

function listScenarioDirs(root: string): string[] {
    const out: string[] = [];
    const stack = [root];
    while (stack.length > 0) {
        const current = stack.pop()!;
        let entries: fs.Dirent[] = [];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            continue;
        }
        const directCaseFiles = entries
            .filter(entry => entry.isFile() && isCaseFile(entry.name))
            .map(entry => entry.name);
        if (directCaseFiles.length > 0) {
            out.push(current);
            continue;
        }
        for (const entry of entries) {
            if (entry.isDirectory()) {
                stack.push(path.join(current, entry.name));
            }
        }
    }
    out.sort((a, b) => a.localeCompare(b));
    return out;
}

function buildScene(projectDir: string): Scene {
    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(projectDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(sceneConfig);
    scene.inferTypes();
    return scene;
}

function resolveCaseMethodName(scene: Scene, caseId: string): string {
    if (caseId.endsWith("_a")) {
        const companion = `${caseId.slice(0, -2)}_b`;
        if (scene.getMethods().some(m => m.getName() === companion)) {
            return companion;
        }
    }
    return caseId;
}

function expectedFromCaseId(caseId: string): boolean {
    return caseId.endsWith("_T") || caseId.includes("_T_");
}

function findCaseMethod(scene: Scene, caseMethodName: string): any | undefined {
    const candidates = scene.getMethods().filter(m => m.getName() === caseMethodName);
    return candidates[0];
}

function collectParamZeroSeeds(engine: TaintPropagationEngine, entryMethod: any): any[] {
    const out: any[] = [];
    const params = entryMethod.getParameterInstances?.() || [];
    if (params.length > 0) {
        const paramNodes = engine.pag.getNodesByValue(params[0]);
        if (paramNodes && paramNodes.size > 0) {
            for (const nodeId of paramNodes.values()) {
                out.push(engine.pag.getNode(nodeId));
            }
            if (out.length > 0) return out;
        }
    }

    const cfg = entryMethod.getCfg?.();
    if (!cfg) return out;
    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const rightOp = stmt.getRightOp();
        if (!(rightOp instanceof ArkParameterRef)) continue;
        if (typeof rightOp.getIndex === "function" && rightOp.getIndex() !== 0) continue;
        const leftOp = stmt.getLeftOp();
        if (!(leftOp instanceof Local)) continue;
        const nodes = engine.pag.getNodesByValue(leftOp);
        if (!nodes || nodes.size === 0) continue;
        for (const nodeId of nodes.values()) {
            out.push(engine.pag.getNode(nodeId));
        }
        break;
    }
    return out;
}

function flowSinkInCaseMethod(scene: Scene, sinkStmt: any, caseMethodName: string): boolean {
    const method = findCaseMethod(scene, caseMethodName);
    if (!method) return false;
    const cfg = method.getCfg?.();
    if (!cfg) return false;
    return cfg.getStmts().includes(sinkStmt);
}

function loadScenarioSpecs(root: string, includeRegex?: RegExp, maxScenarios?: number): ScenarioSpec[] {
    const scenarioDirs = listScenarioDirs(root);
    const specs: ScenarioSpec[] = [];
    for (const sourceDir of scenarioDirs) {
        const relDir = path.relative(root, sourceDir).split(path.sep).join("/");
        if (includeRegex && !includeRegex.test(relDir)) continue;

        const fileNames = fs.readdirSync(sourceDir)
            .filter(name => isCaseFile(name))
            .sort((a, b) => a.localeCompare(b));
        if (fileNames.length === 0) continue;

        const scene = buildScene(sourceDir);
        const cases: CaseSpec[] = fileNames.map(fileName => {
            const caseId = path.basename(fileName, ".ets");
            return {
                caseId,
                relativeFile: fileName,
                caseMethodName: resolveCaseMethodName(scene, caseId),
                expected: expectedFromCaseId(caseId),
            };
        });

        specs.push({
            id: relDir.length > 0 ? relDir.replace(/[\\/]/g, "__") : "root",
            sourceDir,
            sourceDirRel: relDir,
            scene,
            cases,
        });

        if (maxScenarios !== undefined && specs.length >= maxScenarios) {
            break;
        }
    }
    return specs;
}

async function runArkTaintScenario(
    scenario: ScenarioSpec,
    rounds: number,
    k: number,
    mode: CompareMode
): Promise<Map<string, boolean>> {
    const detections = new Map<string, boolean>();
    for (let round = 1; round <= rounds; round++) {
        for (const item of scenario.cases) {
            let detected = false;
            try {
                const engine = new TaintPropagationEngine(scenario.scene, k);
                engine.verbose = false;
                await engine.buildPAG();

                const entryMethod = findCaseMethod(scenario.scene, item.caseMethodName);
                if (!entryMethod) {
                    throw new Error(`case method not found: scenario=${scenario.sourceDirRel}, entry=${item.caseMethodName}`);
                }
                const seeds = collectParamZeroSeeds(engine, entryMethod);
                if (seeds.length > 0) {
                    engine.propagateWithSeeds(seeds);
                }
                const flows = engine.detectSinks("Sink")
                    .filter(flow => flowSinkInCaseMethod(scenario.scene, flow.sink, item.caseMethodName));
                detected = flows.length > 0;
            } catch (err: any) {
                detected = false;
                if (round === 1) {
                    console.error(`arktaint_case_error scenario=${scenario.sourceDirRel} case=${item.caseId}: ${err?.message || err}`);
                }
            }

            const old = detections.get(item.caseId);
            if (old === undefined) {
                detections.set(item.caseId, detected);
            } else if (old !== detected) {
                throw new Error(`arktaint detection drift: scenario=${scenario.sourceDirRel}, case=${item.caseId}, round=${round}`);
            }
        }
    }
    return detections;
}

function buildMarkdown(report: SummaryReport): string {
    const lines: string[] = [];
    lines.push("# Senior Strict Compare (ArkTaint vs Arktan)");
    lines.push("");
    lines.push(`- generatedAt: ${report.generatedAt}`);
    lines.push(`- mode: ${report.mode}`);
    lines.push(`- sourceRoot: ${report.sourceRoot}`);
    lines.push(`- arktanRoot: ${report.arktanRoot}`);
    lines.push(`- rounds: ${report.rounds}`);
    lines.push(`- k: ${report.k}`);
    lines.push(`- scenarioCount: ${report.scenarioCount}`);
    lines.push(`- totalCases: ${report.totalCases}`);
    lines.push(`- arktaint: pass=${report.arktaint.passCases}, fp=${report.arktaint.fp}, fn=${report.arktaint.fn}`);
    lines.push(`- arktan: pass=${report.arktan.passCases}, fp=${report.arktan.fp}, fn=${report.arktan.fn}`);
    lines.push("");

    for (const scenario of report.scenarios) {
        lines.push(`## ${scenario.sourceDir}`);
        lines.push(`- totalCases: ${scenario.totalCases}`);
        lines.push(`- arktaint: pass=${scenario.arktaintPassCases}, fp=${scenario.arktaintFp}, fn=${scenario.arktaintFn}`);
        lines.push(`- arktan: pass=${scenario.arktanPassCases}, fp=${scenario.arktanFp}, fn=${scenario.arktanFn}`);
        if (scenario.arktaintError) {
            lines.push(`- arktaintError: ${scenario.arktaintError}`);
        }
        if (scenario.arktanError) {
            lines.push(`- arktanError: ${scenario.arktanError}`);
        }
        if (scenario.arktanMissingCaseMethods.length > 0) {
            lines.push(`- arktanMissingCaseMethods: ${scenario.arktanMissingCaseMethods.join(", ")}`);
        }
        for (const item of scenario.caseResults) {
            if (item.arktaintDetected === item.expected && item.arktanDetected === item.expected) continue;
            lines.push(`- case=${item.caseId}, expected=${item.expected ? "T" : "F"}, arktaint=${item.arktaintDetected ? "T" : "F"}, arktan=${item.arktanDetected ? "T" : "F"}, entry=${item.caseMethodName}`);
        }
        lines.push("");
    }

    return lines.join("\n");
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    if (!fs.existsSync(args.sourceRoot)) {
        throw new Error(`sourceRoot not found: ${args.sourceRoot}`);
    }
    if (!fs.existsSync(args.arktanRoot)) {
        throw new Error(`arktanRoot not found: ${args.arktanRoot}`);
    }

    fs.mkdirSync(args.outputDir, { recursive: true });
    const runnerPath = ensureArktanRunnerScript(args.outputDir);
    const scenarios = loadScenarioSpecs(args.sourceRoot, args.includeRegex, args.maxScenarios);
    if (scenarios.length === 0) {
        throw new Error(`no scenarios found under ${args.sourceRoot}`);
    }

    const reports: ScenarioReport[] = [];
    let totalCases = 0;
    let arktaintPassCases = 0;
    let arktanPassCases = 0;
    let arktaintFp = 0;
    let arktaintFn = 0;
    let arktanFp = 0;
    let arktanFn = 0;

    for (const scenario of scenarios) {
        const arktaintDetections = await runArkTaintScenario(scenario, args.rounds, args.k, args.mode);
        const arktanCases: ArktanCaseSpec[] = scenario.cases.map(item => ({
            caseId: item.caseId,
            caseMethodName: item.caseMethodName,
        }));
        let arktanDetectedSet = new Set<string>();
        let arktanMissingCaseMethods: string[] = [];
        let arktanError: string | undefined;
        try {
            const arktanResult = runArktanCaseSetRound(
                scenario.id,
                scenario.sourceDir,
                arktanCases,
                "Sink",
                [],
                {
                    outputDir: args.outputDir,
                    arktanRoot: args.arktanRoot,
                },
                runnerPath
            );
            arktanDetectedSet = new Set(arktanResult.detectedCases);
            arktanMissingCaseMethods = arktanResult.missingCaseMethods || [];
        } catch (err: any) {
            arktanError = err?.message || String(err);
            console.error(`arktan_scenario_error scenario=${scenario.sourceDirRel}: ${arktanError}`);
        }

        const caseResults: CaseResult[] = scenario.cases.map(item => {
            const arktaintDetected = arktaintDetections.get(item.caseId) || false;
            const arktanDetected = arktanDetectedSet.has(item.caseId);
            return {
                caseId: item.caseId,
                caseMethodName: item.caseMethodName,
                expected: item.expected,
                arktaintDetected,
                arktanDetected,
            };
        });

        const scenarioArktanPass = caseResults.filter(item => item.arktanDetected === item.expected).length;
        const scenarioArkTaintPass = caseResults.filter(item => item.arktaintDetected === item.expected).length;
        const scenarioArktanFp = caseResults.filter(item => !item.expected && item.arktanDetected).length;
        const scenarioArktanFn = caseResults.filter(item => item.expected && !item.arktanDetected).length;
        const scenarioArkTaintFp = caseResults.filter(item => !item.expected && item.arktaintDetected).length;
        const scenarioArkTaintFn = caseResults.filter(item => item.expected && !item.arktaintDetected).length;

        totalCases += caseResults.length;
        arktaintPassCases += scenarioArkTaintPass;
        arktanPassCases += scenarioArktanPass;
        arktaintFp += scenarioArkTaintFp;
        arktaintFn += scenarioArkTaintFn;
        arktanFp += scenarioArktanFp;
        arktanFn += scenarioArktanFn;

        reports.push({
            scenarioId: scenario.id,
            sourceDir: scenario.sourceDirRel,
            totalCases: caseResults.length,
            arktaintPassCases: scenarioArkTaintPass,
            arktanPassCases: scenarioArktanPass,
            arktaintFp: scenarioArkTaintFp,
            arktaintFn: scenarioArkTaintFn,
            arktanFp: scenarioArktanFp,
            arktanFn: scenarioArktanFn,
            arktanMissingCaseMethods,
            arktanError,
            caseResults,
        });
    }

    const summary: SummaryReport = {
        generatedAt: new Date().toISOString(),
        mode: args.mode,
        sourceRoot: args.sourceRoot,
        arktanRoot: args.arktanRoot,
        rounds: args.rounds,
        k: args.k,
        scenarioCount: reports.length,
        totalCases,
        arktaint: {
            passCases: arktaintPassCases,
            fp: arktaintFp,
            fn: arktaintFn,
        },
        arktan: {
            passCases: arktanPassCases,
            fp: arktanFp,
            fn: arktanFn,
        },
        scenarios: reports,
    };

    const jsonPath = path.join(args.outputDir, "senior_compare_report.json");
    const mdPath = path.join(args.outputDir, "senior_compare_report.md");
    fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2), "utf-8");
    fs.writeFileSync(mdPath, buildMarkdown(summary), "utf-8");

    console.log("====== Senior Compare (ArkTaint vs Arktan) ======");
    console.log(`mode=${args.mode}`);
    console.log(`source_root=${args.sourceRoot}`);
    console.log(`scenario_count=${reports.length}`);
    console.log(`total_cases=${totalCases}`);
    console.log(`arktaint_pass=${arktaintPassCases}`);
    console.log(`arktaint_fp=${arktaintFp}`);
    console.log(`arktaint_fn=${arktaintFn}`);
    console.log(`arktan_pass=${arktanPassCases}`);
    console.log(`arktan_fp=${arktanFp}`);
    console.log(`arktan_fn=${arktanFn}`);
    console.log(`report_json=${jsonPath}`);
    console.log(`report_md=${mdPath}`);
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});

