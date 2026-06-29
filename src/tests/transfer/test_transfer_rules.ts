import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { SinkRule, TransferRule } from "../../core/rules/RuleSchema";
import type { ExactRuleRuntime } from "../rules/ExactRuleTestUtils";
import { buildExactTransferScenario } from "./ExactTransferScenarioFactory";
import { findLocalSeedNodes } from "./ExactTransferTestUtils";
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
    k: number;
}

function parseArgs(argv: string[]): CliOptions {
    let sourceDir = "tests/demo/rule_transfer";
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
    sinkRules: SinkRule[],
    transferRules: TransferRule[],
    runtime: ExactRuleRuntime,
): Promise<boolean> {
    const entryMethod = scene.getMethods().find(method => method.getName() === caseName);
    if (!entryMethod) {
        throw new Error(`entry method not found: ${caseName}`);
    }
    const engine = new TaintPropagationEngine(scene, k, { ...runtime, transferRules, includeBuiltinModules: false });
    engine.verbose = false;
    await engine.buildPAG({
        entryModel: "explicit",
        syntheticEntryMethods: [entryMethod],
    });
    engine.setActiveReachableMethodSignatures(undefined, { mergeExplicitEntryScope: false });

    const seedNodes = findLocalSeedNodes(engine, scene, caseName, "taint_src");
    if (seedNodes.length === 0) return false;
    engine.propagateWithSeeds(seedNodes);
    const flows = engine.detectSinksByRules(sinkRules);
    return flows.some(flow => flowSinkInCaseMethod(scene, flow.sink, caseName));
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    if (!fs.existsSync(options.sourceDir)) {
        throw new Error(`Source directory not found: ${options.sourceDir}`);
    }

    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(options.sourceDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(sceneConfig);
    scene.inferTypes();

    const cases = listTestCases(options.sourceDir);
    if (cases.length === 0) {
        throw new Error(`No .ets cases found under ${options.sourceDir}`);
    }
    const scenario = buildExactTransferScenario({
        scene,
        scenarioId: "rule_transfer",
        caseNames: cases,
    });
    const sourceRules = scenario.sourceRules;
    const sinkRules = scenario.sinkRules;
    const transferRules = scenario.transferRules;
    const exactRuntime = scenario.exactRuntime;
    console.log(`source_rules_loaded=${sourceRules.length}`);
    console.log(`sink_rules_loaded=${sinkRules.length}`);
    console.log(`transfer_rules_loaded=${transferRules.length}`);

    const results: CaseResult[] = [];
    let passCount = 0;
    let ruleDrivenTrueCaseCount = 0;

    for (const caseName of cases) {
        const expected = caseName.endsWith("_T");
        const detectedWithRules = await detectFlowForCase(scene, caseName, options.k, sinkRules, transferRules, exactRuntime);
        const detectedWithoutRules = await detectFlowForCase(scene, caseName, options.k, sinkRules, [], exactRuntime);

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


