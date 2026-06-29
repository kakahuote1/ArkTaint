import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { TransferRule } from "../../core/rules/RuleSchema";
import { validateRuleSet } from "../../core/rules/RuleValidator";
import { exactTransferRule } from "../rules/ExactRuleTestUtils";
import {
    assertCanonicalExactRules,
    exactTransferRuntimeFromFixtures,
} from "./ExactTransferTestUtils";
import * as path from "path";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function findMethod(scene: Scene, methodName: string, className: string) {
    const method = scene.getMethods().find(m =>
        m.getName() === methodName
        && m.getDeclaringArkClass?.()?.getName?.() === className
    );
    assert(method, `method not found: ${className}.${methodName}`);
    return method;
}

async function main(): Promise<void> {
    const sourceDir = path.resolve("tests/demo/rule_precision_transfer");
    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(sourceDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(sceneConfig);
    scene.inferTypes();

    const bridgeMethod = findMethod(scene, "BridgeScope", "ScopeHostAllowed");
    const exactTransfer = exactTransferRule({
        id: "transfer.identity.canonical.bridge_scope",
        method: bridgeMethod,
        from: "arg0",
        to: "result",
    });
    const canonicalRules = [exactTransfer.rule];
    assertCanonicalExactRules(canonicalRules);

    const missingEffect = validateRuleSet({
        sources: [],
        sinks: [],
        transfers: [
            {
                id: "transfer.identity.missing_effect",
                match: {
                    kind: "canonical_api_id_equals",
                    value: exactTransfer.rule.apiEffect.canonicalApiId,
                },
                from: "arg0",
                to: "result",
            } as any,
        ],
    });
    assert(!missingEffect.valid, "canonical transfer rule without apiEffect must be rejected");
    assert(
        missingEffect.errors.some(error => error.includes("apiEffect is required")),
        `expected missing apiEffect error, got ${missingEffect.errors.join("; ")}`,
    );

    const exactCanonical = validateRuleSet({
        sources: [],
        sinks: [],
        transfers: canonicalRules,
    });
    assert(exactCanonical.valid, `canonical transfer selector should pass: ${exactCanonical.errors.join("; ")}`);

    const exactRuntime = exactTransferRuntimeFromFixtures([exactTransfer]);
    const engine = new TaintPropagationEngine(scene, 1, { ...exactRuntime, transferRules: canonicalRules, includeBuiltinModules: false });
    engine.verbose = false;
    await engine.buildPAG({
        entryModel: "explicit",
        syntheticEntryMethods: [bridgeMethod],
    });

    console.log("====== Transfer Identity Completeness Guard Test ======");
    console.log("missing_api_effect_rejected=PASS");
    console.log("exact_canonical_selector_accepted=PASS");
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
