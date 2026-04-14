import { createRuleCandidateExpander } from "../../core/semanticflow/SemanticFlowExpanders";
import { buildSemanticFlowRuleCandidateItem } from "../../core/semanticflow/SemanticFlowAdapters";
import { normalizeNoCandidateItem } from "../../core/model/callsite/callsiteContextSlices";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

async function main(): Promise<void> {
    const primary = normalizeNoCandidateItem({
        callee_signature: "@project/demo.ets: Store.get(string)",
        method: "get",
        invokeKind: "instance",
        argCount: 1,
        sourceFile: "demo.ets",
        contextSlices: [
            {
                callerFile: "demo.ets",
                callerMethod: "loadValue",
                invokeLine: 10,
                invokeStmtText: "store.get(key)",
                windowLines: "10 | store.get(key)",
                cfgNeighborStmts: ["store.get(key)"],
            },
        ],
    });
    const companion = normalizeNoCandidateItem({
        callee_signature: "@project/demo.ets: Store.set(string,string)",
        method: "set",
        invokeKind: "instance",
        argCount: 2,
        sourceFile: "demo.ets",
        contextSlices: [
            {
                callerFile: "demo.ets",
                callerMethod: "saveValue",
                invokeLine: 20,
                invokeStmtText: "store.set(key, value)",
                windowLines: "20 | store.set(key, value)",
                cfgNeighborStmts: ["store.set(key, value)"],
            },
        ],
    });
    const callbackPeer = normalizeNoCandidateItem({
        callee_signature: "@project/demo.ets: Store.bind(string,(value:string)=>void)",
        method: "bind",
        invokeKind: "instance",
        argCount: 2,
        sourceFile: "demo.ets",
        contextSlices: [
            {
                callerFile: "demo.ets",
                callerMethod: "listenValue",
                invokeLine: 30,
                invokeStmtText: "store.bind(key, (value) => sink(value))",
                windowLines: "29 | const sink = createSink();\n30 | store.bind(key, (value) => sink(value))",
                cfgNeighborStmts: ["store.bind(key, (value) => sink(value))"],
            },
        ],
    });
    const metaPeer = normalizeNoCandidateItem({
        callee_signature: "@project/demo.ets: Store.observe()",
        method: "observe",
        invokeKind: "instance",
        argCount: 0,
        sourceFile: "demo.ets",
        contextSlices: [
            {
                callerFile: "demo.ets",
                callerMethod: "buildView",
                invokeLine: 40,
                invokeStmtText: "this.observe()",
                windowLines: "39 | @State token: string = '';\n40 | this.observe()",
                cfgNeighborStmts: ["@State token: string = '';", "this.observe()"],
            },
        ],
    });
    const wrapperOnly = normalizeNoCandidateItem({
        callee_signature: "@project/router.ets: Router.getParams()",
        method: "getParams",
        invokeKind: "static",
        argCount: 0,
        sourceFile: "router.ets",
        contextSlices: [],
        methodSnippet: "154 | public static getParams(): Object {\n155 |   return router.getParams()\n156 | }",
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
    } as any);

    const expander = createRuleCandidateExpander([primary, companion, callbackPeer, metaPeer]);
    const item = buildSemanticFlowRuleCandidateItem(primary, { maxContextSlices: 1 });
    const seededItem = buildSemanticFlowRuleCandidateItem(primary, {
        maxContextSlices: 1,
        companionCandidates: [companion],
    });
    assert(seededItem.initialSlice.template === "multi-surface", `expected initial multi-surface template, got ${seededItem.initialSlice.template}`);
    assert((seededItem.initialSlice.companions || []).includes("set"), "expected initial companion surface set");
    assert(seededItem.initialSlice.snippets.some(snippet => snippet.label === "companion-set"), "expected initial companion snippet");

    const expanded = await expander.expand({
        anchor: item.anchor,
        slice: item.initialSlice,
        round: 0,
        request: {
            kind: "q_comp",
            why: ["need companion surface evidence"],
            ask: "show related write surface",
        },
        history: [],
    });

    assert(expanded.template === "multi-surface", `expected multi-surface template, got ${expanded.template}`);
    assert((expanded.companions || []).includes("set"), "expected companion surface set to be attached");
    assert(expanded.snippets.some(snippet => snippet.label === "companion-set"), "expected companion snippet for set");
    assert(expanded.notes?.includes("show related write surface"), "expected expand note to be preserved");

    const callbackExpanded = await expander.expand({
        anchor: item.anchor,
        slice: item.initialSlice,
        round: 0,
        request: {
            kind: "q_cb",
            why: ["need callback evidence"],
            ask: "show callback registration or dispatch evidence",
        },
        history: [],
    });
    assert(callbackExpanded.snippets.some(snippet => snippet.label.startsWith("companion-bind")), "expected callback peer snippet");
    assert(callbackExpanded.snippets.some(snippet => snippet.label.startsWith("focus-cb")), "expected callback focus snippet");

    const metaExpanded = await expander.expand({
        anchor: item.anchor,
        slice: item.initialSlice,
        round: 0,
        request: {
            kind: "q_meta",
            why: ["need metadata evidence"],
            ask: "show decorator or bound field evidence",
        },
        history: [],
    });
    assert(metaExpanded.snippets.some(snippet => snippet.label.startsWith("companion-observe")), "expected metadata peer snippet");
    assert(metaExpanded.snippets.some(snippet => snippet.label.startsWith("focus-meta")), "expected metadata focus snippet");

    const wrapperExpander = createRuleCandidateExpander([wrapperOnly]);
    const wrapperItem = buildSemanticFlowRuleCandidateItem(wrapperOnly);
    assert(wrapperItem.initialSlice.template === "multi-surface", "wrapper owner-family evidence should upgrade initial template");
    assert(wrapperItem.initialSlice.snippets.some(snippet => snippet.label === "owner-context"), "wrapper owner-family evidence should be present in round0");
    assert(wrapperItem.initialSlice.snippets.some(snippet => snippet.label === "owner-sibling-push"), "wrapper owner-family sibling should be present in round0");
    const ownerExpanded = await wrapperExpander.expand({
        anchor: wrapperItem.anchor,
        slice: wrapperItem.initialSlice,
        round: 0,
        request: {
            kind: "q_comp",
            why: ["need wrapper companion evidence"],
            ask: "show owner-level companion context",
        },
        history: [],
    });
    assert(ownerExpanded.snippets.some(snippet => snippet.label === "owner-context"), "expected owner-context snippet when no explicit companion candidate exists");
    assert(ownerExpanded.snippets.filter(snippet => snippet.label === "owner-context").length === 1, "owner-context should not be duplicated across expansion");
    assert(ownerExpanded === wrapperItem.initialSlice, "q_comp should no-op when owner-family evidence is already present in round0");

    console.log("PASS test_semanticflow_rule_expander");
}

main().catch(error => {
    console.error("FAIL test_semanticflow_rule_expander");
    console.error(error);
    process.exit(1);
});
