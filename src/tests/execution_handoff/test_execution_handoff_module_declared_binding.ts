import * as path from "path";
import { defineModule } from "../../core/kernel/contracts/ModuleContract";
import { assert } from "../helpers/ExecutionHandoffContractSupport";
import { buildInferenceScene } from "../helpers/ExecutionHandoffInferenceSupport";
import { buildEngineForCase, findCaseMethod, resolveCaseMethod } from "../helpers/SyntheticCaseHarness";

async function main(): Promise<void> {
    const projectDir = path.resolve("tests/adhoc/execution_handoff_semantic_module_declared");
    const scene = buildInferenceScene(projectDir);
    const entry = resolveCaseMethod(scene, "module_declared_binding_001_T.ets", "module_declared_binding_001_T");
    const entryMethod = findCaseMethod(scene, entry);
    assert(!!entryMethod, "missing entry method for module_declared_binding_001_T");

    const withoutModule = await buildEngineForCase(scene, 1, entryMethod!, {
        verbose: false,
        entryModel: "explicit",
    });
    const withoutSnapshot = withoutModule.getExecutionHandoffContractSnapshot();
    const withoutDeclaredContract = withoutSnapshot?.contracts.find(item =>
        item.unitSignature.includes("%AM0$module_declared_binding_001_T"),
    );
    assert(!withoutDeclaredContract, "unknown onReady should not become a deferred contract without an explicit module binding");

    const explicitBindingModule = defineModule({
        id: "fixture.module_declared_binding",
        description: "Declare future execution bindings for UnknownAsync.onReady.",
        setup(ctx) {
            for (const invoke of ctx.scan.invokes({
                declaringClassName: "UnknownAsync",
                methodName: "onReady",
                instanceOnly: true,
                minArgs: 1,
            })) {
                ctx.deferred.imperativeFromInvoke(invoke, 0, {
                    reason: "Module-declared UnknownAsync.onReady deferred binding",
                });
            }
        },
    });

    const withModule = await buildEngineForCase(scene, 1, entryMethod!, {
        verbose: false,
        entryModel: "explicit",
        engineOptions: {
            modules: [explicitBindingModule],
        },
    });
    const withSnapshot = withModule.getExecutionHandoffContractSnapshot();
    assert(withSnapshot && withSnapshot.totalContracts > 0, "module-declared binding should export a deferred contract");

    const declaredContract = withSnapshot!.contracts.find(item =>
        item.unitSignature.includes("%AM0$module_declared_binding_001_T"),
    );
    assert(!!declaredContract, "module-declared binding should export the callback future unit");
    assert(declaredContract!.activation === "event(c)", "module-declared binding should recover event(c)");
    assert(declaredContract!.activationLabel === "register", "module-declared imperative binding should project register activation label");
    assert(declaredContract!.carrierKind === "direct", "module-declared imperative binding should default to direct carrier kind");

    console.log("execution_handoff_module_declared_binding=PASS");
}

main().catch(err => {
    console.error("execution_handoff_module_declared_binding=FAIL");
    console.error(err);
    process.exitCode = 1;
});
