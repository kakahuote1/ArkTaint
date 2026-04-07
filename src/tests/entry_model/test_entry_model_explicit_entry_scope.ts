import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { loadRuleSet } from "../../core/rules/RuleLoader";
import { SinkRule, SourceRule, TransferRule } from "../../core/rules/RuleSchema";
import { findCaseMethod, resolveCaseMethod } from "../helpers/SyntheticCaseHarness";
import { registerMockSdkFiles } from "../helpers/TestSceneBuilder";

interface ProbeSpec {
    sourceDir: string;
    caseName: string;
    projectRulePath: string;
    ruleCatalogPath?: string;
    expectedMethodRef: string;
}

function buildScene(projectDir: string): Scene {
    const config = new SceneConfig();
    config.buildFromProjectDir(projectDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    registerMockSdkFiles(scene);
    return scene;
}

function loadRules(spec: ProbeSpec): { sourceRules: SourceRule[]; sinkRules: SinkRule[]; transferRules: TransferRule[] } {
    const loaded = loadRuleSet({
        ruleCatalogPath: path.resolve(spec.ruleCatalogPath || "src/rules"),
        projectRulePath: path.resolve(spec.projectRulePath),
        allowMissingProject: false,
        autoDiscoverLayers: false,
    });
    return {
        sourceRules: loaded.ruleSet.sources || [],
        sinkRules: loaded.ruleSet.sinks || [],
        transferRules: loaded.ruleSet.transfers || [],
    };
}

function methodRef(method: any): string {
    const className = method?.getDeclaringArkClass?.()?.getName?.() || "@global";
    const methodName = method?.getName?.() || "@unknown";
    return `${className}.${methodName}`;
}

async function runProbe(spec: ProbeSpec): Promise<void> {
    const scene = buildScene(path.resolve(spec.sourceDir));
    const { sourceRules, sinkRules, transferRules } = loadRules(spec);
    const engine = new TaintPropagationEngine(scene, 1, { transferRules });
    engine.verbose = false;

    const resolvedEntry = resolveCaseMethod(scene, `${spec.caseName}.ets`, spec.caseName);
    const caseMethod = findCaseMethod(scene, resolvedEntry);
    await engine.buildPAG({
        entryModel: "arkMain",
        syntheticEntryMethods: caseMethod ? [caseMethod] : undefined,
    });

    const reachable = engine.computeReachableMethodSignatures();
    engine.setActiveReachableMethodSignatures(reachable);
    const activeReachable = engine.getActiveReachableMethodSignatures();
    const expectedMethod = scene.getMethods().find(method => methodRef(method) === spec.expectedMethodRef);
    if (!expectedMethod) {
        throw new Error(`Failed to resolve expected method: ${spec.expectedMethodRef}`);
    }
    const expectedSignature = expectedMethod.getSignature().toString();
    if (!activeReachable?.has(expectedSignature)) {
        throw new Error(`arkMain active reachable scope missing ${spec.expectedMethodRef}`);
    }

    const seedInfo = engine.propagateWithSourceRules(sourceRules);
    if (seedInfo.seedCount <= 0) {
        throw new Error(`arkMain produced no source seeds for ${spec.caseName}`);
    }

    const flows = engine.detectSinksByRules(sinkRules);
    if (flows.length <= 0) {
        throw new Error(`arkMain detected no sink flows for ${spec.caseName}`);
    }
}

async function main(): Promise<void> {
    const probes: ProbeSpec[] = [
        {
            sourceDir: "tests/demo/harmony_lifecycle",
            caseName: "lifecycle_want_direct_001_T",
            projectRulePath: "tests/rules/harmony_lifecycle_sink_only.rules.json",
            ruleCatalogPath: "src/rules",
            expectedMethodRef: "AbilityWantDirect001.onCreate",
        },
        {
            sourceDir: "tests/demo/harmony_lifecycle",
            caseName: "lifecycle_extension_formbinding_013_T",
            projectRulePath: "tests/rules/harmony_lifecycle_sink_only.rules.json",
            ruleCatalogPath: "src/rules",
            expectedMethodRef: "DemoFormExtension013.onUpdateForm",
        },
        {
            sourceDir: "tests/demo/harmony_lifecycle",
            caseName: "lifecycle_extension_addform_011_T",
            projectRulePath: "tests/rules/harmony_lifecycle_sink_only.rules.json",
            ruleCatalogPath: "src/rules",
            expectedMethodRef: "DemoFormExtension011.onAddForm",
        },
    ];

    for (const probe of probes) {
        await runProbe(probe);
    }

    console.log("PASS test_entry_model_explicit_entry_scope");
}

main().catch(error => {
    console.error("FAIL test_entry_model_explicit_entry_scope");
    console.error(error);
    process.exit(1);
});
