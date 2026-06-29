import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { SinkRule, TransferRule } from "../../core/rules/RuleSchema";
import type { ExactRuleRuntime } from "../rules/ExactRuleTestUtils";
import { buildExactTransferScenario } from "./ExactTransferScenarioFactory";
import { findLocalSeedNodes } from "./ExactTransferTestUtils";
import * as fs from "fs";
import * as path from "path";

interface CliOptions {
    sourceDir: string;
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

function flowSinkInCaseMethod(scene: Scene, sinkStmt: any, caseMethodName: string): boolean {
    const method = scene.getMethods().find(m => m.getName() === caseMethodName);
    if (!method) return false;
    const cfg = method.getCfg();
    if (!cfg) return false;
    return cfg.getStmts().includes(sinkStmt);
}

async function runCase(
    scene: Scene,
    caseName: string,
    k: number,
    sinkRules: SinkRule[],
    transferRules: TransferRule[],
    runtime: ExactRuleRuntime,
): Promise<CaseRunResult> {
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
    engine.propagateWithSeeds(seedNodes);
    const flows = engine.detectSinksByRules(sinkRules);
    const scopedFlows = flows.filter(flow => flowSinkInCaseMethod(scene, flow.sink, caseName));
    const transferRuleHits = [...new Set(
        scopedFlows.flatMap(flow => flow.transferRuleIds || [])
    )].sort();

    return {
        detected: scopedFlows.length > 0,
        seedCount: seedNodes.length,
        transferRuleHits,
    };
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
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
            expectedRuleId: "transfer.priority.method_scoped.host.arg0_to_result",
        },
    ];
    const scenario = buildExactTransferScenario({
        scene,
        scenarioId: "transfer_priority",
        caseNames: cases.map(item => item.caseName),
    });
    const sourceRules = scenario.sourceRules;
    const sinkRules = scenario.sinkRules;
    const transferRules = scenario.transferRules;
    const exactRuntime = scenario.exactRuntime;

    let passCount = 0;
    console.log("====== Transfer Priority Test ======");
    console.log(`k=${options.k}`);
    console.log(`source_rules_loaded=${sourceRules.length}`);
    console.log(`sink_rules_loaded=${sinkRules.length}`);
    console.log(`transfer_rules_loaded=${transferRules.length}`);

    for (const c of cases) {
        const withRules = await runCase(scene, c.caseName, options.k, sinkRules, transferRules, exactRuntime);
        const withoutRules = await runCase(scene, c.caseName, options.k, sinkRules, [], exactRuntime);

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


