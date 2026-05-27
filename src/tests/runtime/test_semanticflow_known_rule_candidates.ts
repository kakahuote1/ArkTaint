import * as fs from "fs";
import * as path from "path";
import type { AssetDocumentBase } from "../../core/assets/schema";
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

function writeProjectModuleAsset(modelRoot: string): void {
    const modulesDir = path.join(modelRoot, "project", "shared_demo", "modules");
    fs.mkdirSync(modulesDir, { recursive: true });
    const doc: AssetDocumentBase = {
        id: "shared_demo.vault",
        plane: "module",
        status: "reviewed",
        surfaces: [
            {
                surfaceId: "surface.shared_demo.vault.get",
                kind: "invoke",
                modulePath: "project/demo",
                ownerName: "Vault",
                methodName: "get",
                invokeKind: "instance",
                argCount: 1,
                confidence: "certain",
                provenance: { source: "manual" },
            },
            {
                surfaceId: "surface.shared_demo.vault.put",
                kind: "invoke",
                modulePath: "project/demo",
                ownerName: "Vault",
                methodName: "put",
                invokeKind: "instance",
                argCount: 2,
                confidence: "certain",
                provenance: { source: "manual" },
            },
        ],
        bindings: [
            {
                bindingId: "binding.shared_demo.vault.get",
                surfaceId: "surface.shared_demo.vault.get",
                assetId: "shared_demo.vault",
                plane: "module",
                role: "handoff",
                effectTemplateRefs: ["template.shared_demo.vault.get"],
                semanticsFamily: "project-keyed-storage",
                completeness: "complete",
                confidence: "certain",
            },
            {
                bindingId: "binding.shared_demo.vault.put",
                surfaceId: "surface.shared_demo.vault.put",
                assetId: "shared_demo.vault",
                plane: "module",
                role: "handoff",
                effectTemplateRefs: ["template.shared_demo.vault.put"],
                semanticsFamily: "project-keyed-storage",
                completeness: "complete",
                confidence: "certain",
            },
        ],
        effectTemplates: [
            {
                id: "template.shared_demo.vault.get",
                kind: "handoff.get",
                handle: {
                    cellKind: "keyed-semantic-slot",
                    family: "project.vault",
                    key: [{ kind: "fromEndpoint", endpoint: { base: { kind: "arg", index: 0 } } }],
                    owner: [{ kind: "const", value: "Vault" }],
                    precision: "infer",
                },
                target: { base: { kind: "return" } },
                confidence: "certain",
            },
            {
                id: "template.shared_demo.vault.put",
                kind: "handoff.put",
                handle: {
                    cellKind: "keyed-semantic-slot",
                    family: "project.vault",
                    key: [{ kind: "fromEndpoint", endpoint: { base: { kind: "arg", index: 0 } } }],
                    owner: [{ kind: "const", value: "Vault" }],
                    precision: "infer",
                },
                value: { base: { kind: "arg", index: 1 } },
                updateStrength: "infer",
                confidence: "certain",
            },
        ],
        provenance: {
            source: "project",
            projectId: "shared_demo",
            evidenceLocations: [{ file: "Vault.ets" }],
        },
    };
    fs.writeFileSync(path.join(modulesDir, "semanticflow.modules.json"), JSON.stringify(doc, null, 2), "utf8");
}

function main(): void {
    const root = path.resolve("tmp/test_runs/runtime/semanticflow_known_rule_candidates/latest");
    const modelRoot = path.join(root, "models");
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });
    writeProjectModuleAsset(modelRoot);

    const assetBackedCandidates = [
        makeCandidate("@ohos/storage: LocalStorage.get(string)", "get", 1),
        makeCandidate("@%unk/%unk: .setUIContent()", "setUIContent", 3),
        makeCandidate("@collections: Map.set(string,string)", "set", 2),
        makeCandidate("@ohos/preferences: Preferences.get(string)", "get", 1),
        makeCandidate("@project/demo: Vault.get(string)", "get", 1),
    ];
    const assetFiltered = filterKnownSemanticFlowRuleCandidates(assetBackedCandidates);
    const skippedSignatures = assetFiltered.skippedKnown.map(item => item.callee_signature);
    const keptSignatures = assetFiltered.candidates.map(item => item.callee_signature);
    assert(skippedSignatures.some(item => item.includes("Map.set")), "asset-backed filter should skip Map.set through the transfer rules");
    assert(skippedSignatures.some(item => item.includes("Preferences.get")), "asset-backed filter should skip Preferences.get through the source rules");
    assert(keptSignatures.some(item => item.includes("LocalStorage.get")), "filter must not skip LocalStorage.get without an exact declared v2 asset identity");
    assert(keptSignatures.some(item => item.includes(".setUIContent")), "filter must not skip setUIContent by name/context heuristic alone");
    assert(keptSignatures.some(item => item.includes("Vault.get")), "filter must keep unknown project Vault.get without an enabled project model");

    const contextFiltered = filterKnownSemanticFlowRuleCandidates([{
        ...makeCandidate("@%unk/%unk: .SetOrCreate()", "SetOrCreate", 2),
        contextSlices: [{
            callerFile: "FolderListComp.ets",
            invokeLine: 62,
            invokeStmtText: "AppStorage.SetOrCreate<number>('ContinueSection', this.sectionStatus)",
            windowLines: "AppStorage.SetOrCreate<number>('ContinueSection', this.sectionStatus)",
            cfgNeighborStmts: [],
        }],
    } as any]);
    assert(contextFiltered.skippedKnown.length === 0, `expected context-only AppStorage evidence not to be a strong known-coverage filter, got ${contextFiltered.skippedKnown.length}`);
    assert(contextFiltered.candidates.length === 1, `expected context-only AppStorage call to remain for modeling/facade evidence, got ${contextFiltered.candidates.length}`);

    const officialLoggingFiltered = filterKnownSemanticFlowRuleCandidates([{
        ...makeCandidate("@ohos/hilog: hilog.info(number, string, string, string)", "info", 4),
    } as any, {
        ...makeCandidate("@ohos/console: console.log(any)", "log", 1),
    } as any]);
    assert(officialLoggingFiltered.skippedKnown.length === 2, `expected direct official logging signatures to be known through sink rules, got ${officialLoggingFiltered.skippedKnown.length}`);
    assert(officialLoggingFiltered.candidates.length === 0, `expected direct official logging calls to be filtered, got ${officialLoggingFiltered.candidates.length}`);

    const unresolvedConsoleContextFiltered = filterKnownSemanticFlowRuleCandidates([{
        ...makeCandidate("@%unk/%unk: .log()", "log", 1),
        contextSlices: [{
            callerFile: "demo.ets",
            invokeLine: 12,
            invokeStmtText: "console.log(secret)",
            windowLines: "console.log(secret)",
            cfgNeighborStmts: [],
        }],
    } as any]);
    assert(unresolvedConsoleContextFiltered.skippedKnown.length === 0, `expected unresolved context-only console.log not to be a strong known filter, got ${unresolvedConsoleContextFiltered.skippedKnown.length}`);
    assert(unresolvedConsoleContextFiltered.candidates.length === 1, `expected unresolved context-only console.log to remain as a candidate, got ${unresolvedConsoleContextFiltered.candidates.length}`);

    const officialArkMainFiltered = filterKnownSemanticFlowRuleCandidates([{
        ...makeCandidate("@demo.ets: DemoAbility.onCreate(Unknown)", "onCreate", 1),
        topEntries: ["origin=recall_api_surface", "candidateBoundary=official_arkmain_entry_evidence"],
    } as any]);
    assert(officialArkMainFiltered.skippedKnown.length === 1, `expected official ArkMain entry evidence to be skipped before LLM, got ${officialArkMainFiltered.skippedKnown.length}`);
    assert(officialArkMainFiltered.candidates.length === 0, `expected no official ArkMain entry candidate to reach LLM, got ${officialArkMainFiltered.candidates.length}`);

    const projectLoggingFiltered = filterKnownSemanticFlowRuleCandidates([{
        ...makeCandidate("@%unk/%unk: .showInfo()", "showInfo", 2),
        contextSlices: [{
            callerFile: "AppCenterStartAppHandler.ts",
            invokeLine: 73,
            invokeStmtText: "Log.showInfo(TAG, `calculateAppIconPosition index ${index}`)",
            windowLines: "Log.showInfo(TAG, `calculateAppIconPosition index ${index}`)",
            cfgNeighborStmts: [],
        }],
    } as any, {
        ...makeCandidate("@ets/common/utils/Logger.ets: Logger.info(string[])", "info", 4),
        sourceFile: "ets/common/utils/Logger.ets",
    } as any]);
    assert(projectLoggingFiltered.skippedKnown.length === 0, `expected project logging wrappers to remain candidates, got ${projectLoggingFiltered.skippedKnown.length}`);
    assert(projectLoggingFiltered.candidates.length === 2, `expected two project logging wrappers to be kept, got ${projectLoggingFiltered.candidates.length}`);

    const projectEventBusFiltered = filterKnownSemanticFlowRuleCandidates([{
        ...makeCandidate("@project/neo/src/main/ets/infra/event/EventBus.ets: EventBus.emit(string, object)", "emit", 2),
        sourceFile: "neo/src/main/ets/infra/event/EventBus.ets",
    } as any, {
        ...makeCandidate("@project/neo/src/main/ets/infra/event/EventBus.ets: EventBus.on(string, Function)", "on", 2),
        sourceFile: "neo/src/main/ets/infra/event/EventBus.ets",
    } as any]);
    assert(projectEventBusFiltered.skippedKnown.length === 0, `expected project EventBus.emit/on to remain candidates, got ${projectEventBusFiltered.skippedKnown.length}`);
    assert(projectEventBusFiltered.candidates.length === 2, `expected project EventBus.emit/on candidates to be preserved, got ${projectEventBusFiltered.candidates.length}`);

    const projectFiltered = filterKnownSemanticFlowRuleCandidates(
        [makeCandidate("@project/demo: Vault.get(string)", "get", 1)],
        {
            modelRoots: [modelRoot],
            enabledModels: ["shared_demo"],
        },
    );
    assert(projectFiltered.skippedKnown.length === 1, `expected enabled project model to cover Vault.get, got ${projectFiltered.skippedKnown.length}`);
    assert(projectFiltered.candidates.length === 0, `expected no remaining candidates after project model filter, got ${projectFiltered.candidates.length}`);

    const enabledEventModelFiltered = filterKnownSemanticFlowRuleCandidates(
        [
            makeCandidate("@project/other: OtherBus.emit(string, object)", "emit", 2),
            makeCandidate("@project/other: OtherBus.on(string, Function)", "on", 2),
        ],
        {
            modelRoots: [modelRoot],
            enabledModels: ["shared_demo"],
        },
    );
    assert(enabledEventModelFiltered.skippedKnown.length === 0, `enabled event_emitter model without explicit coverage surfaces must not filter unrelated on/emit names, got ${enabledEventModelFiltered.skippedKnown.length}`);
    assert(enabledEventModelFiltered.candidates.length === 2, `expected unrelated project on/emit to remain for LLM, got ${enabledEventModelFiltered.candidates.length}`);

    console.log("PASS test_semanticflow_known_rule_candidates");
}

main();
