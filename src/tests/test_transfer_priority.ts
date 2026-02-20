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
    transferRuleHits: string[];
}

interface CaseExpect {
    caseName: string;
    expectedRuleId: string;
}

function parseArgs(argv: string[]): CliOptions {
    let sourceDir = "tests/demo/transfer_priority";
    let defaultRulePath = "tests/rules/minimal.rules.json";
    let projectRulePath = "tests/rules/transfer_priority.rules.json";
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
    const transferRuleHits = Object.entries(engine.getRuleHitCounters().transfer)
        .filter(([, hit]) => hit > 0)
        .map(([id]) => id)
        .sort();

    return {
        detected: scopedFlows.length > 0,
        seedCount: seedInfo.seedCount,
        transferRuleHits,
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

    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(options.sourceDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(sceneConfig);
    scene.inferTypes();

    const cases: CaseExpect[] = [
        {
            caseName: "transfer_priority_001_T",
            expectedRuleId: "transfer.priority.exact.class_exact.arg0_to_result",
        },
        {
            caseName: "transfer_priority_002_T",
            expectedRuleId: "transfer.priority.constrained.scope.arg0_to_result",
        },
        {
            caseName: "transfer_priority_003_T",
            expectedRuleId: "transfer.priority.fuzzy.name_regex.arg0_to_result",
        },
    ];

    let passCount = 0;
    console.log("====== Transfer Priority Test ======");
    console.log(`k=${options.k}`);
    console.log(`source_rules_loaded=${sourceRules.length}`);
    console.log(`sink_rules_loaded=${sinkRules.length}`);
    console.log(`transfer_rules_loaded=${transferRules.length}`);

    for (const c of cases) {
        const withRules = await runCase(scene, c.caseName, options.k, sourceRules, sinkRules, transferRules);
        const withoutRules = await runCase(scene, c.caseName, options.k, sourceRules, sinkRules, []);

        const hitExactlyExpected = withRules.transferRuleHits.length === 1
            && withRules.transferRuleHits[0] === c.expectedRuleId;
        const pass = withRules.detected
            && !withoutRules.detected
            && hitExactlyExpected
            && withRules.seedCount > 0;
        if (pass) passCount++;

        console.log(
            `${pass ? "PASS" : "FAIL"} ${c.caseName} `
            + `withRules=${withRules.detected} withoutRules=${withoutRules.detected} `
            + `seedCount=${withRules.seedCount} transferHits=${withRules.transferRuleHits.join(",") || "N/A"} `
            + `expectedRule=${c.expectedRuleId}`
        );
    }

    console.log(`total_cases=${cases.length}`);
    console.log(`pass_cases=${passCount}`);
    console.log(`fail_cases=${cases.length - passCount}`);
    if (passCount !== cases.length) {
        process.exitCode = 1;
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});

