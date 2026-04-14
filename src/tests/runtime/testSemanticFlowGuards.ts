import { normalizeNoCandidateItem } from "../../core/model/callsite/callsiteContextSlices";
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

    const arkCandidateA = buildFakeArkMainCandidate("<@Entry: DemoAbility.onCreate(Want)>");
    const arkCandidateB = buildFakeArkMainCandidate("<@Entry: DemoAbility.onCreate(Want,string)>");
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
