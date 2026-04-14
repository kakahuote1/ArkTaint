import * as fs from "fs";
import * as path from "path";
import type { ModuleSpecDocument } from "../../core/kernel/contracts/ModuleSpec";
import type { NormalizedCallsiteItem } from "../../core/model/callsite/callsiteContextSlices";
import { filterKnownSemanticFlowRuleCandidates } from "../../cli/semanticflowKnownRuleCandidates";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function makeCandidate(signature: string, method: string, argCount: number): NormalizedCallsiteItem {
    return {
        callee_signature: signature,
        method,
        invokeKind: "instance",
        argCount,
        sourceFile: "demo.ets",
    };
}

function writeProjectModuleSpec(modelRoot: string): void {
    const modulesDir = path.join(modelRoot, "project", "shared_demo", "modules");
    fs.mkdirSync(modulesDir, { recursive: true });
    const doc: ModuleSpecDocument = {
        modules: [
            {
                id: "shared_demo.vault",
                semantics: [
                    {
                        kind: "keyed_storage",
                        storageClasses: ["Vault"],
                        writeMethods: [{ methodName: "put", valueIndex: 1 }],
                        readMethods: ["get"],
                    },
                ],
            },
        ],
    };
    fs.writeFileSync(path.join(modulesDir, "semanticflow.modules.json"), JSON.stringify(doc, null, 2), "utf8");
}

function main(): void {
    const root = path.resolve("tmp/test_runs/runtime/semanticflow_known_rule_candidates/latest");
    const modelRoot = path.join(root, "models");
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });
    writeProjectModuleSpec(modelRoot);

    const builtinCandidates = [
        makeCandidate("@ohos/storage: LocalStorage.get(string)", "get", 1),
        makeCandidate("@collections: Map.set(string,string)", "set", 2),
        makeCandidate("@ohos/preferences: Preferences.get(string)", "get", 1),
        makeCandidate("@project/demo: Vault.get(string)", "get", 1),
    ];
    const builtinFiltered = filterKnownSemanticFlowRuleCandidates(builtinCandidates);
    assert(builtinFiltered.skippedKnown.length === 3, `expected three builtin known candidates, got ${builtinFiltered.skippedKnown.length}`);
    assert(builtinFiltered.candidates.length === 1, `expected one candidate after builtin filtering, got ${builtinFiltered.candidates.length}`);
    assert(builtinFiltered.candidates[0].method === "get" && builtinFiltered.candidates[0].callee_signature.includes("Vault.get"), "builtin filter should keep unknown Vault.get");

    const projectFiltered = filterKnownSemanticFlowRuleCandidates(
        [makeCandidate("@project/demo: Vault.get(string)", "get", 1)],
        {
            modelRoots: [modelRoot],
            enabledModels: ["shared_demo"],
        },
    );
    assert(projectFiltered.skippedKnown.length === 1, `expected enabled project model to cover Vault.get, got ${projectFiltered.skippedKnown.length}`);
    assert(projectFiltered.candidates.length === 0, `expected no remaining candidates after project model filter, got ${projectFiltered.candidates.length}`);

    console.log("PASS test_semanticflow_known_rule_candidates");
}

main();
