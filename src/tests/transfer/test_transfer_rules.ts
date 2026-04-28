import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { SinkRule, SourceRule, TaintRuleSet, TransferRule } from "../../core/rules/RuleSchema";
import * as fs from "fs";
import * as path from "path";

interface CaseResult {
    name: string;
    expected: boolean;
    detectedWithRules: boolean;
    detectedWithoutRules: boolean;
    pass: boolean;
    note: string;
}

interface CliOptions {
    sourceDir: string;
    projectRulePath: string;
    k: number;
}

function parseArgs(argv: string[]): CliOptions {
    let sourceDir = "tests/demo/rule_transfer";
    let projectRulePath = "tests/rules/transfer_only.rules.json";
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
        projectRulePath: path.resolve(projectRulePath),
        k,
    };
}

function listTestCases(sourceDir: string): string[] {
    const files = fs.readdirSync(sourceDir)
        .filter(f => f.endsWith(".ets"))
        .map(f => path.basename(f, ".ets"))
        .sort();
    return files;
}

function flowSinkInCaseMethod(scene: Scene, sinkStmt: any, caseMethodName: string): boolean {
    const method = scene.getMethods().find(m => m.getName() === caseMethodName);
    if (!method) return false;
    const cfg = method.getCfg();
    if (!cfg) return false;
    return cfg.getStmts().includes(sinkStmt);
}

async function detectFlowForCase(
    scene: Scene,
    caseName: string,
    k: number,
    sourceRules: SourceRule[],
    sinkRules: SinkRule[],
    transferRules: TransferRule[]
): Promise<boolean> {
    const engine = new TaintPropagationEngine(scene, k, { transferRules });
    engine.verbose = false;
    await engine.buildPAG();
    engine.setActiveReachableMethodSignatures(undefined, { mergeExplicitEntryScope: false });

    const seedInfo = engine.propagateWithSourceRules(sourceRules);
    if (seedInfo.seedCount === 0) return false;
    const flows = engine.detectSinksByRules(sinkRules);
    return flows.some(flow => flowSinkInCaseMethod(scene, flow.sink, caseName));
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    if (!fs.existsSync(options.sourceDir)) {
        throw new Error(`Source directory not found: ${options.sourceDir}`);
    }
    if (!fs.existsSync(options.projectRulePath)) {
        throw new Error(`Project rule file not found: ${options.projectRulePath}`);
    }

    const loadedRules = JSON.parse(fs.readFileSync(options.projectRulePath, "utf-8")) as TaintRuleSet;
    const sourceRules = loadedRules.sources || [];
    const sinkRules = loadedRules.sinks || [];
    const transferRules = loadedRules.transfers || [];
    console.log(`source_rules_loaded=${sourceRules.length}`);
    console.log(`sink_rules_loaded=${sinkRules.length}`);
    console.log(`transfer_rules_loaded=${transferRules.length}`);

    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(options.sourceDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(sceneConfig);
    scene.inferTypes();

    const cases = listTestCases(options.sourceDir);
    if (cases.length === 0) {
        throw new Error(`No .ets cases found under ${options.sourceDir}`);
    }

    const results: CaseResult[] = [];
    let passCount = 0;
    let ruleDrivenTrueCaseCount = 0;

    for (const caseName of cases) {
        const expected = caseName.endsWith("_T");
        const detectedWithRules = await detectFlowForCase(scene, caseName, options.k, sourceRules, sinkRules, transferRules);
        const detectedWithoutRules = await detectFlowForCase(scene, caseName, options.k, sourceRules, sinkRules, []);

        let pass = false;
        let note = "";
        if (expected) {
            const isRuleDriven = detectedWithRules && !detectedWithoutRules;
            pass = isRuleDriven;
            note = isRuleDriven
                ? "rule_driven_true_case"
                : `expected_true_but_withRules=${detectedWithRules},withoutRules=${detectedWithoutRules}`;
            if (isRuleDriven) {
                ruleDrivenTrueCaseCount++;
            }
        } else {
            pass = !detectedWithRules;
            note = pass
                ? "expected_false_ok"
                : "unexpected_flow_with_rules";
        }

        if (pass) passCount++;
        results.push({
            name: caseName,
            expected,
            detectedWithRules,
            detectedWithoutRules,
            pass,
            note,
        });
    }

    console.log("====== Transfer Rule Execution Test ======");
    console.log(`total_cases=${results.length}`);
    console.log(`pass_cases=${passCount}`);
    console.log(`fail_cases=${results.length - passCount}`);
    console.log(`rule_driven_true_cases=${ruleDrivenTrueCaseCount}`);

    for (const r of results) {
        console.log(
            `${r.pass ? "PASS" : "FAIL"} ${r.name} expected=${r.expected ? "T" : "F"} `
            + `withRules=${r.detectedWithRules} withoutRules=${r.detectedWithoutRules} note=${r.note}`
        );
    }

    const minimalRuleDrivenTrueCases = 5;
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


