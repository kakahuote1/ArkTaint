import { Scene } from "../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../core/TaintPropagationEngine";
import { loadRuleSet } from "../core/rules/RuleLoader";
import { SinkRule, SourceRule, TransferRule } from "../core/rules/RuleSchema";
import * as fs from "fs";
import * as path from "path";

interface CliOptions {
    sourceDir: string;
    defaultRulePath: string;
    projectRulePath: string;
    k: number;
}

interface CaseRunResult {
    detected: boolean;
    seedCount: number;
}

interface CaseResult {
    name: string;
    expected: boolean;
    detectedWithRules: boolean;
    detectedWithoutRules: boolean;
    pass: boolean;
    note: string;
}

function parseArgs(argv: string[]): CliOptions {
    let sourceDir = "tests/demo/transfer_overload_conflicts";
    let defaultRulePath = "tests/rules/minimal.rules.json";
    let projectRulePath = "tests/rules/transfer_overload_conflicts.rules.json";
    let k = 1;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--sourceDir" && i + 1 < argv.length) {
            sourceDir = argv[++i];
            continue;
        }
        if (arg.startsWith("--sourceDir=")) {
            sourceDir = arg.slice("--sourceDir=".length);
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
        if (arg === "--project" && i + 1 < argv.length) {
            projectRulePath = argv[++i];
            continue;
        }
        if (arg.startsWith("--project=")) {
            projectRulePath = arg.slice("--project=".length);
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
    }

    if (k !== 0 && k !== 1) {
        throw new Error(`Invalid --k value: ${k}. Expected 0 or 1.`);
    }

    return {
        sourceDir: path.resolve(sourceDir),
        defaultRulePath: path.resolve(defaultRulePath),
        projectRulePath: path.resolve(projectRulePath),
        k,
    };
}

function listCases(sourceDir: string): string[] {
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

async function runCase(
    scene: Scene,
    caseName: string,
    k: number,
    sourceRules: SourceRule[],
    sinkRules: SinkRule[],
    transferRules: TransferRule[]
): Promise<CaseRunResult> {
    const engine = new TaintPropagationEngine(scene, k, { transferRules });
    engine.verbose = false;
    await engine.buildPAG(caseName);

    const seedInfo = engine.propagateWithSourceRules(sourceRules, {
        entryMethodName: caseName,
    });
    const flows = engine.detectSinksByRules(sinkRules);
    const scopedFlows = flows.filter(flow => flowSinkInEntryMethod(scene, flow.sink, caseName));
    return {
        detected: scopedFlows.length > 0,
        seedCount: seedInfo.seedCount,
    };
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const loaded = loadRuleSet({
        defaultRulePath: options.defaultRulePath,
        projectRulePath: options.projectRulePath,
        autoDiscoverLayers: false,
    });
    const sourceRules: SourceRule[] = loaded.ruleSet.sources || [];
    const sinkRules: SinkRule[] = loaded.ruleSet.sinks || [];
    const transferRules: TransferRule[] = loaded.ruleSet.transfers || [];

    console.log(`source_rules_loaded=${sourceRules.length}`);
    console.log(`sink_rules_loaded=${sinkRules.length}`);
    console.log(`transfer_rules_loaded=${transferRules.length}`);

    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(options.sourceDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(sceneConfig);
    scene.inferTypes();

    const cases = listCases(options.sourceDir).filter(name => name !== "taint_mock");
    const results: CaseResult[] = [];
    let passCount = 0;
    let ruleDrivenTrueCaseCount = 0;

    for (const caseName of cases) {
        const expected = caseName.endsWith("_T");
        const withRules = await runCase(
            scene,
            caseName,
            options.k,
            sourceRules,
            sinkRules,
            transferRules
        );
        const withoutRules = await runCase(
            scene,
            caseName,
            options.k,
            sourceRules,
            sinkRules,
            []
        );

        let pass = false;
        let note = "";
        if (expected) {
            const isRuleDriven = withRules.detected && !withoutRules.detected;
            pass = isRuleDriven;
            note = isRuleDriven
                ? "rule_driven_true_case"
                : `expected_true_but_withRules=${withRules.detected},withoutRules=${withoutRules.detected}`;
            if (isRuleDriven) {
                ruleDrivenTrueCaseCount++;
            }
        } else {
            pass = !withRules.detected;
            note = pass ? "expected_false_ok" : "unexpected_flow_with_rules";
        }

        if (pass) passCount++;
        results.push({
            name: caseName,
            expected,
            detectedWithRules: withRules.detected,
            detectedWithoutRules: withoutRules.detected,
            pass,
            note,
        });
    }

    console.log("====== Transfer Overload Conflicts Test ======");
    console.log(`k=${options.k}`);
    console.log(`total_cases=${results.length}`);
    console.log(`pass_cases=${passCount}`);
    console.log(`fail_cases=${results.length - passCount}`);
    console.log(`rule_driven_true_cases=${ruleDrivenTrueCaseCount}`);
    for (const r of results) {
        console.log(
            `${r.pass ? "PASS" : "FAIL"} ${r.name} expected=${r.expected ? "T" : "F"} `
            + `withRules=${r.detectedWithRules} withoutRules=${r.detectedWithoutRules} `
            + `note=${r.note}`
        );
    }

    const minimalRuleDrivenTrueCases = 3;
    if (ruleDrivenTrueCaseCount < minimalRuleDrivenTrueCases) {
        console.error(
            `rule_driven_true_cases_too_few=${ruleDrivenTrueCaseCount}, `
            + `required>=${minimalRuleDrivenTrueCases}`
        );
        process.exitCode = 1;
        return;
    }

    if (passCount !== results.length) {
        process.exitCode = 1;
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});

