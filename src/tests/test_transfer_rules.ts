import { Scene } from "../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../arkanalyzer/out/src/Config";
import { ArkAssignStmt } from "../../arkanalyzer/out/src/core/base/Stmt";
import { ArkParameterRef } from "../../arkanalyzer/out/src/core/base/Ref";
import { Local } from "../../arkanalyzer/out/src/core/base/Local";
import { TaintPropagationEngine } from "../core/TaintPropagationEngine";
import { loadRuleSet } from "../core/rules/RuleLoader";
import { TransferRule } from "../core/rules/RuleSchema";
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
    overrideRulePath: string;
    k: number;
}

function parseArgs(argv: string[]): CliOptions {
    let sourceDir = "tests/demo/rule_transfer";
    let overrideRulePath = "tests/rules/transfer_only.rules.json";
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
        if (arg === "--override" && i + 1 < argv.length) {
            overrideRulePath = argv[++i];
            continue;
        }
        if (arg.startsWith("--override=")) {
            overrideRulePath = arg.slice("--override=".length);
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
        overrideRulePath: path.resolve(overrideRulePath),
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

function findEntryMethod(scene: Scene, entryName: string): any {
    const method = scene.getMethods().find(m => m.getName() === entryName);
    if (!method) {
        throw new Error(`Entry method not found: ${entryName}`);
    }
    return method;
}

function collectParameterSeedLocals(entryMethod: any): Local[] {
    const out: Local[] = [];
    const cfg = entryMethod.getCfg();
    if (!cfg) return out;

    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        if (!(stmt.getRightOp() instanceof ArkParameterRef)) continue;
        const leftOp = stmt.getLeftOp();
        if (leftOp instanceof Local) out.push(leftOp);
    }
    return out;
}

function collectSeedNodes(engine: TaintPropagationEngine, entryMethod: any): any[] {
    const seedNodes: any[] = [];
    const seenNodeIds = new Set<number>();
    const seedLocals = collectParameterSeedLocals(entryMethod);

    for (const local of seedLocals) {
        if (local.getName() !== "taint_src") continue;
        const nodes = engine.pag.getNodesByValue(local);
        if (!nodes) continue;
        for (const nodeId of nodes.values()) {
            if (seenNodeIds.has(nodeId)) continue;
            seenNodeIds.add(nodeId);
            seedNodes.push(engine.pag.getNode(nodeId));
        }
    }
    return seedNodes;
}

async function detectFlowForCase(
    scene: Scene,
    caseName: string,
    k: number,
    transferRules: TransferRule[]
): Promise<boolean> {
    const engine = new TaintPropagationEngine(scene, k, { transferRules });
    engine.verbose = false;
    await engine.buildPAG(caseName);

    const entryMethod = findEntryMethod(scene, caseName);
    const seeds = collectSeedNodes(engine, entryMethod);
    if (seeds.length === 0) {
        throw new Error(`No taint_src parameter seeds found for case: ${caseName}`);
    }

    engine.propagateWithSeeds(seeds);
    const flows = engine.detectSinks("Sink");
    return flows.length > 0;
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    if (!fs.existsSync(options.sourceDir)) {
        throw new Error(`Source directory not found: ${options.sourceDir}`);
    }
    if (!fs.existsSync(options.overrideRulePath)) {
        throw new Error(`Override rule file not found: ${options.overrideRulePath}`);
    }

    const loadedRules = loadRuleSet({
        overrideRulePath: options.overrideRulePath,
        allowMissingOverride: false,
    });
    const transferRules = loadedRules.ruleSet.transfers || [];
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
        const detectedWithRules = await detectFlowForCase(scene, caseName, options.k, transferRules);
        const detectedWithoutRules = await detectFlowForCase(scene, caseName, options.k, []);

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
