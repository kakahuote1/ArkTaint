import * as fs from "fs";
import * as path from "path";
import { normalizeNoCandidateItem } from "../../core/model/callsite/callsiteContextSlices";
import { enrichNoCandidateItemsWithCallsiteSlices } from "../../core/model/callsite/callsiteContextSlices";
import { splitArkMainEntryCandidatesForSemanticFlow } from "../../core/entry/arkmain/llm/ArkMainEntryCandidateFilter";
import { buildSemanticFlowArkMainCandidateItem, buildSemanticFlowRuleCandidateItem } from "../../core/semanticflow/SemanticFlowAdapters";
import { createArkMainCandidateExpander } from "../../core/semanticflow/SemanticFlowExpanders";
import type { ArkMainEntryCandidate } from "../../core/entry/arkmain/llm/ArkMainEntryCandidateTypes";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function buildFakeArkMainCandidate(methodSignature: string): ArkMainEntryCandidate {
    const fakeMethod = {
        getCfg() {
            return {
                getStmts() {
                    return [
                        {
                            getOriginalText() {
                                return "const payload = want;";
                            },
                        },
                    ];
                },
            };
        },
    };
    return {
        method: fakeMethod as any,
        methodSignature,
        className: "DemoAbility",
        methodName: "onCreate",
        filePath: "entry/src/main/ets/EntryAbility.ets",
        superClassName: "UIAbility",
        parameterTypes: ["Want"],
        returnType: "void",
        isOverride: true,
        ownerSignals: ["owner_contract:ability_owner:framework_contract"],
        overrideSignals: ["override:explicit"],
        frameworkSignals: ["framework_hint:ability", "framework_hint:want"],
    };
}

async function main(): Promise<void> {
    const ruleA = normalizeNoCandidateItem({
        callee_signature: "<@A: Box.cloneValue(string)>",
        method: "cloneValue",
        invokeKind: "instance",
        argCount: 1,
        sourceFile: "entry/src/main/ets/box.ets",
    });
    const ruleB = normalizeNoCandidateItem({
        callee_signature: "<@B: Box.cloneValue(string)>",
        method: "cloneValue",
        invokeKind: "instance",
        argCount: 1,
        sourceFile: "entry/src/main/ets/box.ets",
    });
    const ruleItemA = buildSemanticFlowRuleCandidateItem(ruleA);
    const ruleItemB = buildSemanticFlowRuleCandidateItem(ruleB);
    assert(ruleItemA.anchor.id !== ruleItemB.anchor.id, "rule anchor ids must stay unique across same-name signatures");
    const ruleWithMethodSnippet = buildSemanticFlowRuleCandidateItem({
        ...ruleA,
        methodSnippet: [
            "   80 | public static getParams(): Object {",
            "   81 |   return router.getParams()",
            "   82 | }",
        ].join("\n"),
        ownerSnippet: [
            "imports:",
            "    1 | import router from '@ohos.router'",
            "",
            "ownerMethods:",
            "   80 | public static push(options: RouterOptions) {",
            "  120 | public static back(options?: RouterOptions) {",
            "  154 | public static getParams(): Object {",
        ].join("\n"),
        ownerMethodSnippets: [
            {
                method: "push",
                code: "   80 | public static push(options: RouterOptions) {\n   81 |   router.pushUrl({ url: options.url, params: options.params }, router.RouterMode.Standard)\n   82 | }",
            },
        ],
        contextError: "no_matching_invoke_found_in_scene",
    } as any);
    assert(ruleWithMethodSnippet.initialSlice.snippets[0]?.label === "method", "rule slice should surface method snippet before candidate fallback");
    assert(ruleWithMethodSnippet.initialSlice.snippets[0]?.code.includes("return router.getParams()"), "rule slice should preserve callee body when no callsite exists");
    assert(ruleWithMethodSnippet.initialSlice.template === "multi-surface", "wrapper-like rule slice should become multi-surface when owner-family evidence exists");
    assert(ruleWithMethodSnippet.initialSlice.snippets.some(snippet => snippet.label === "owner-context"), "wrapper-like rule slice should include owner context");
    assert(ruleWithMethodSnippet.initialSlice.snippets.some(snippet => snippet.label === "owner-sibling-push"), "wrapper-like rule slice should include owner sibling snippet");
    assert((ruleWithMethodSnippet.initialSlice.companions || []).includes("push"), "wrapper-like rule slice should expose owner sibling as companion");
    assert(ruleWithMethodSnippet.initialSlice.observations.includes("methodSnippet=available"), "rule slice should record method snippet availability");
    assert(ruleWithMethodSnippet.initialSlice.observations.includes("ownerMethodSnippets=1"), "rule slice should record owner family evidence");

    const abstractRoot = path.resolve("tmp/test_runs/runtime/semanticflow_guards/abstract_method_snippet");
    const abstractSourceDir = path.join(abstractRoot, "feature/src/main/ets");
    const abstractDecoyDir = path.join(abstractRoot, "entry/src/main/ets");
    fs.rmSync(abstractRoot, { recursive: true, force: true });
    fs.mkdirSync(abstractSourceDir, { recursive: true });
    fs.mkdirSync(abstractDecoyDir, { recursive: true });
    fs.writeFileSync(path.join(abstractDecoyDir, "BaseViewModel.ets"), [
        "export class BaseViewModel {",
        "  other(): void {}",
        "}",
    ].join("\n"), "utf8");
    fs.writeFileSync(path.join(abstractSourceDir, "BaseViewModel.ets"), [
        "export abstract class BaseViewModel {",
        "  protected abstract processIntentWithModel(intention: BaseIntent, model: BaseModel, state: BaseState): Promise<ProcessResult>;",
        "  protected processIntentWithModelSync(intention: BaseIntent, model: BaseModel, state: BaseState): ProcessResult {",
        "    return ProcessResult.SUCCESS;",
        "  }",
        "}",
    ].join("\n"), "utf8");
    const enrichedAbstract = enrichNoCandidateItemsWithCallsiteSlices({
        repoRoot: abstractRoot,
        sourceDirs: ["entry/src/main/ets", "feature/src/main/ets"],
        items: [normalizeNoCandidateItem({
            callee_signature: "@ets/BaseViewModel.ets: BaseViewModel.processIntentWithModel(BaseIntent, BaseModel, BaseState)",
            method: "processIntentWithModel",
            invokeKind: "instance",
            argCount: 3,
            sourceFile: "ets/BaseViewModel.ets",
        })],
        maxItems: 1,
        maxExamplesPerItem: 1,
        contextRadius: 1,
        cfgNeighborRadius: 1,
    });
    const abstractSnippet = String((enrichedAbstract[0] as any).methodSnippet || "");
    assert(abstractSnippet.includes("protected abstract processIntentWithModel"), "abstract method declarations should be extracted as method snippets");
    assert(!abstractSnippet.includes("processIntentWithModelSync"), "declaration-only method snippet should stop at the semicolon");

    const syntheticRoot = path.resolve("tmp/test_runs/runtime/semanticflow_guards/synthetic_method_snippet");
    const syntheticSourceDir = path.join(syntheticRoot, "entry/src/main/ets");
    fs.rmSync(syntheticRoot, { recursive: true, force: true });
    fs.mkdirSync(path.join(syntheticSourceDir, "entryability"), { recursive: true });
    fs.writeFileSync(path.join(syntheticSourceDir, "entryability/EntryAbility.ets"), [
        "export default class EntryAbility {",
        "  async onWindowStageCreate(windowStage: WindowStage): Promise<void> {",
        "    await this.initStore();",
        "    windowStage.loadContent('view/EntryPage', (_) => {",
        "      UIInitializer.init(windowStage, this.context);",
        "    });",
        "  }",
        "  initStore(): Promise<void> {",
        "    return Promise.resolve();",
        "  }",
        "}",
    ].join("\n"), "utf8");
    const enrichedSynthetic = enrichNoCandidateItemsWithCallsiteSlices({
        repoRoot: syntheticRoot,
        sourceDirs: ["entry/src/main/ets"],
        items: [normalizeNoCandidateItem({
            callee_signature: "@ets/entryability/EntryAbility.ets: EntryAbility.%AM0$onWindowStageCreate([windowStage], unknown)",
            method: "%AM0$onWindowStageCreate",
            invokeKind: "instance",
            argCount: 2,
            sourceFile: "ets/entryability/EntryAbility.ets",
        })],
        maxItems: 1,
        maxExamplesPerItem: 1,
        contextRadius: 1,
        cfgNeighborRadius: 1,
    });
    const syntheticSnippet = String((enrichedSynthetic[0] as any).methodSnippet || "");
    assert(syntheticSnippet.includes("onWindowStageCreate(windowStage"), "synthetic method should fall back to its source host method body");
    assert(syntheticSnippet.includes("windowStage.loadContent"), "synthetic fallback should preserve host method body evidence");
    assert((enrichedSynthetic[0] as any).methodSnippetSource === "onWindowStageCreate", "synthetic fallback should record the source method name");
    const syntheticItem = buildSemanticFlowRuleCandidateItem(enrichedSynthetic[0]);
    assert(syntheticItem.initialSlice.observations.includes("methodSnippet=available"), "synthetic fallback should expose method snippet availability");
    assert(syntheticItem.initialSlice.observations.includes("methodSnippetSource=onWindowStageCreate"), "synthetic fallback should expose source method name");
    assert(syntheticItem.initialSlice.snippets.some(snippet => snippet.label === "method" && snippet.code.includes("UIInitializer.init")), "synthetic fallback should place host method body in the prompt slice");

    const arkCandidateA = buildFakeArkMainCandidate("<@Entry: DemoAbility.onCreate(Want)>");
    const arkCandidateB = buildFakeArkMainCandidate("<@Entry: DemoAbility.onCreate(Want,string)>");
    const split = splitArkMainEntryCandidatesForSemanticFlow([arkCandidateA, {
        ...arkCandidateB,
        methodName: "loadContent",
        ownerSignals: ["owner_contract:ability_owner:framework_contract"],
        superClassName: "UIAbility",
    }, {
        ...arkCandidateB,
        methodName: "onSave",
        className: "AccountForm",
        superClassName: "CustomComponent",
        ownerSignals: ["owner_contract:component_owner:framework_contract"],
        overrideSignals: [],
        frameworkSignals: ["framework_hint:component", "framework_hint:ui"],
    }]);
    assert(split.kernelCoveredCandidates.length === 1, `expected one kernel-covered arkmain candidate, got ${split.kernelCoveredCandidates.length}`);
    assert(split.semanticFlowCandidates.length === 1, `expected one semanticflow arkmain candidate, got ${split.semanticFlowCandidates.length}`);
    assert(split.ineligibleCandidates.length === 1, `expected one ineligible arkmain candidate, got ${split.ineligibleCandidates.length}`);
    assert(split.kernelCoveredCandidates[0].methodName === "onCreate", "onCreate should be filtered as kernel-covered");
    assert(split.semanticFlowCandidates[0].methodName === "loadContent", "unknown method should stay in semanticflow candidate set");
    assert(split.ineligibleCandidates[0].methodName === "onSave", "component event handlers should not be modeled as formal ArkMain entries");
    const arkItemA = buildSemanticFlowArkMainCandidateItem(arkCandidateA);
    const arkItemB = buildSemanticFlowArkMainCandidateItem(arkCandidateB);
    assert(arkItemA.anchor.id !== arkItemB.anchor.id, "arkmain anchor ids must stay unique across overload signatures");
    assert(arkItemA.initialSlice.snippets.some(snippet => snippet.label === "method"), "arkmain round0 should include method code snippet");
    assert(arkItemA.initialSlice.snippets.some(snippet => snippet.label === "owner-context"), "arkmain round0 should include owner context snippet");
    assert(!arkItemA.initialSlice.snippets.some(snippet => snippet.code.includes("owner_contract:")), "arkmain prompt slice must not leak owner signal tags");
    assert(!arkItemA.initialSlice.snippets.some(snippet => snippet.code.includes("framework_hint:")), "arkmain prompt slice must not leak framework hint tags");

    const expander = createArkMainCandidateExpander([arkCandidateA]);
    const deficit = {
        id: "def.arkmain.body",
        kind: "q_recv" as const,
        focus: {
            from: { slot: "arg" as const, index: 0 },
            carrierHint: "owner_slot",
        },
        scope: {
            owner: "DemoAbility",
            locality: "owner" as const,
            surface: "onCreate",
        },
        budgetClass: "owner_local" as const,
        why: ["need body evidence"],
        ask: "show owner context and body",
    };
    const plan = {
        kind: "q_recv" as const,
        seed: { mode: "owner" as const, value: "DemoAbility" },
        edges: ["E_recv", "E_scope"],
        budgetClass: "owner_local" as const,
        stopCondition: "receiver-write-or-scope-exhausted",
    };

    const expandedOnce = await expander.expand({
        anchor: arkItemA.anchor,
        draftId: "draft.arkmain.demoability.oncreate",
        slice: arkItemA.initialSlice,
        round: 0,
        deficit,
        plan,
        history: [],
    });
    const onceMethodBodyCount = expandedOnce.slice.snippets.filter(snippet => snippet.label === "method-body").length;
    const onceOwnerCount = expandedOnce.slice.snippets.filter(snippet => snippet.label === "owner-context").length;
    assert(onceMethodBodyCount === 1, `expected one method-body snippet after first expansion, got ${onceMethodBodyCount}`);
    assert(onceOwnerCount === 1, `expected one owner-context snippet after first expansion, got ${onceOwnerCount}`);
    assert(expandedOnce.delta.effective, "first arkmain expansion should be effective");

    const expandedTwice = await expander.expand({
        anchor: arkItemA.anchor,
        draftId: "draft.arkmain.demoability.oncreate",
        slice: expandedOnce.slice,
        round: 1,
        deficit,
        plan,
        history: [],
    });
    const twiceMethodBodyCount = expandedTwice.slice.snippets.filter(snippet => snippet.label === "method-body").length;
    const twiceOwnerCount = expandedTwice.slice.snippets.filter(snippet => snippet.label === "owner-context").length;
    assert(twiceMethodBodyCount === 1, `duplicate arkmain expansion must not append method-body twice, got ${twiceMethodBodyCount}`);
    assert(twiceOwnerCount === 1, `duplicate arkmain expansion must not append owner-context twice, got ${twiceOwnerCount}`);
    assert(!expandedTwice.delta.effective, "duplicate arkmain expansion should be a no-op delta");

    console.log("PASS testSemanticFlowGuards");
}

main().catch(error => {
    console.error("FAIL testSemanticFlowGuards");
    console.error(error);
    process.exit(1);
});
