import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { resolveKnownOptionCallbackRegistrationsFromStmt } from "../../core/substrate/semantics/KnownOptionCallbackRegistration";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { SinkRule, SourceRule } from "../../core/rules/RuleSchema";
import * as path from "path";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function findMethodSignatureForStmt(scene: Scene, stmt: any): string {
    for (const method of scene.getMethods()) {
        const cfg = method.getCfg?.();
        if (!cfg) continue;
        if (cfg.getStmts?.()?.includes(stmt)) {
            return method.getSignature?.()?.toString?.() || "";
        }
    }
    return "";
}

async function main(): Promise<void> {
    const sourceDir = path.resolve("tests/demo/harmony_component_property_callback");
    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(sourceDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(sceneConfig);
    scene.inferTypes();

    const matches: string[] = [];
    for (const method of scene.getMethods()) {
        const methodSig = method.getSignature?.().toString?.() || "";
        if (!methodSig.includes("ConstructorDialog")) continue;
        for (const stmt of method.getCfg?.()?.getStmts?.() || []) {
            const text = String(stmt.toString?.() || "");
            if (!text.includes("this.confirm")) continue;
            const registrations = resolveKnownOptionCallbackRegistrationsFromStmt(stmt, scene, method);
            for (const registration of registrations) {
                matches.push(registration.callbackMethod?.getSignature?.()?.toString?.() || "");
            }
        }
    }

    assert(matches.some(signature => signature.includes("HostPage") && signature.includes("%AM")),
        `expected constructor-lowered component property callback to resolve HostPage callback, got ${matches.join(", ")}`);

    const sourceRules: SourceRule[] = [
        {
            id: "source.fixture.textinput.onchange",
            enabled: true,
            match: { kind: "method_name_equals", value: "onChange" },
            sourceKind: "callback_param",
            target: { endpoint: "arg0" },
            callbackArgIndexes: [0],
        },
    ];
    const sinkRules: SinkRule[] = [
        {
            id: "sink.fixture.host.sink",
            enabled: true,
            match: { kind: "method_name_equals", value: "sink" },
            target: { endpoint: "arg0" },
        },
    ];

    const engine = new TaintPropagationEngine(scene, 1);
    engine.verbose = false;
    await engine.buildPAG({ entryModel: "arkMain" });
    const seedInfo = engine.propagateWithSourceRules(sourceRules);
    const flows = engine.detectSinksByRules(sinkRules);
    const hostSinkFlows = flows.filter(flow => {
        const signature = findMethodSignatureForStmt(scene, flow.sink);
        return signature.includes("HostPage") && String(flow.sink?.toString?.() || "").includes("sink");
    });

    assert(seedInfo.seedCount > 0, "expected TextInput.onChange callback parameter source to seed");
    assert(hostSinkFlows.length > 0,
        `expected onChange -> @Link state -> confirm callback -> host sink flow, got ${flows.length} total flows`);

    console.log("PASS test_harmony_component_property_callback");
    console.log(`callbacks=${matches.length}`);
    console.log(`seed_count=${seedInfo.seedCount}`);
    console.log(`host_sink_flows=${hostSinkFlows.length}`);
}

main().catch(error => {
    console.error("FAIL test_harmony_component_property_callback");
    console.error(error);
    process.exitCode = 1;
});
