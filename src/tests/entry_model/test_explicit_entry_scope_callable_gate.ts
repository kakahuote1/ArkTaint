import * as path from "path";
import { Scene } from "../../../arkanalyzer/lib/Scene";
import { SceneConfig } from "../../../arkanalyzer/lib/Config";
import { expandEntryMethodsByDirectCalls } from "../../core/entry/shared/ExplicitEntryScopeResolver";
import { findCaseMethod, resolveCaseMethod } from "../helpers/SyntheticCaseHarness";

interface ScopeProbe {
    fileName: string;
    caseName: string;
    expectedSinkCallbackReachable: boolean;
}

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function buildScene(projectDir: string): Scene {
    const config = new SceneConfig();
    config.buildFromProjectDir(projectDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    return scene;
}

function methodContainsSink(method: any): boolean {
    const cfg = method?.getCfg?.();
    if (!cfg) return false;
    for (const stmt of cfg.getStmts()) {
        if (!stmt?.containsInvokeExpr?.()) continue;
        const signature = stmt.getInvokeExpr?.()?.getMethodSignature?.()?.toString?.() || "";
        if (signature.includes(".Sink(")) return true;
    }
    return false;
}

async function main(): Promise<void> {
    const projectDir = path.resolve("tests/demo/explicit_entry_scope_callable_gate");
    const scene = buildScene(projectDir);
    const probes: ScopeProbe[] = [
        {
            fileName: "callback_known_foreach_001_T.ets",
            caseName: "callback_known_foreach_001_T",
            expectedSinkCallbackReachable: true,
        },
        {
            fileName: "callback_unknown_helper_002_F.ets",
            caseName: "callback_unknown_helper_002_F",
            expectedSinkCallbackReachable: false,
        },
        {
            fileName: "callback_promise_then_003_T.ets",
            caseName: "callback_promise_then_003_T",
            expectedSinkCallbackReachable: true,
        },
    ];

    for (const probe of probes) {
        const entry = resolveCaseMethod(scene, probe.fileName, probe.caseName);
        const entryMethod = findCaseMethod(scene, entry);
        assert(entryMethod, `failed to resolve entry for ${probe.caseName}`);

        const expanded = expandEntryMethodsByDirectCalls(scene, [entryMethod]);
        const expandedSignatures = new Set(
            expanded.map(method => method.getSignature?.()?.toString?.()).filter((sig): sig is string => !!sig),
        );

        const callbackCandidates = scene.getMethods().filter(method => {
            const signature = method.getSignature?.()?.toString?.() || "";
            return signature.includes(probe.fileName)
                && method.getName?.() !== probe.caseName
                && methodContainsSink(method);
        });
        assert(callbackCandidates.length > 0, `failed to locate sink callback method for ${probe.caseName}`);

        const hasReachableSinkCallback = callbackCandidates.some(method => {
            const signature = method.getSignature?.()?.toString?.();
            return !!signature && expandedSignatures.has(signature);
        });
        if (hasReachableSinkCallback !== probe.expectedSinkCallbackReachable) {
            throw new Error(
                `explicit entry scope callable gate mismatch for ${probe.caseName}: `
                + `expected=${probe.expectedSinkCallbackReachable} got=${hasReachableSinkCallback}`,
            );
        }
    }

    console.log("PASS test_explicit_entry_scope_callable_gate");
}

main().catch(error => {
    console.error("FAIL test_explicit_entry_scope_callable_gate");
    console.error(error);
    process.exit(1);
});
