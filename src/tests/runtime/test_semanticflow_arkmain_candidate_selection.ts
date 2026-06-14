import { selectArkMainCandidatesForRuleContext } from "../../core/semanticflow/SemanticFlowProject";
import type { ArkMainEntryCandidate } from "../../core/entry/arkmain/llm/ArkMainEntryCandidateTypes";
import type { NormalizedCallsiteItem } from "../../core/model/callsite/callsiteContextSlices";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function entryCandidate(className: string, methodName: string, filePath: string): ArkMainEntryCandidate {
    return {
        method: {
            getName: () => methodName,
            getSignature: () => ({ toString: () => `${filePath}: ${className}.${methodName}()` }),
        } as any,
        methodSignature: `${filePath}: ${className}.${methodName}()`,
        className,
        methodName,
        filePath,
        parameterTypes: [],
        isOverride: false,
        ownerSignals: ["owner_contract:component_owner:decorator"],
        overrideSignals: [],
        frameworkSignals: [],
    };
}

function main(): void {
    const unrelatedHighSignal = entryCandidate("UnrelatedPanel", "build", "entry/src/main/ets/pages/UnrelatedPanel.ets");
    unrelatedHighSignal.ownerSignals.push("owner_contract:component_owner:extra");
    const chatAppear = entryCandidate("ChatView", "aboutToAppear", "chatuikit/src/main/ets/components/chat/ChatView.ets");
    const chatBuild = entryCandidate("ChatView", "build", "chatuikit/src/main/ets/components/chat/ChatView.ets");
    const chatInputBuild = entryCandidate("ChatInputMenuView", "build", "chatuikit/src/main/ets/components/chat/ChatComponents.ets");

    const ruleCandidate: NormalizedCallsiteItem = {
        callee_signature: "@%unk/%unk: .ChatInputMenuView()",
        method: "ChatInputMenuView",
        invokeKind: "static",
        argCount: 1,
        sourceFile: "chatuikit/src/main/ets/components/chat/ChatComponents.ets",
        contextSlices: [
            {
                callerFile: "chatuikit/src/main/ets/components/chat/ChatView.ets",
                invokeLine: 539,
                invokeStmtText: "ChatInputMenuView({ onClickSend })",
                windowLines: "ChatInputMenuView({ onClickSend })",
            },
        ],
    };

    const selected = selectArkMainCandidatesForRuleContext(
        [unrelatedHighSignal, chatAppear, chatBuild, chatInputBuild],
        [ruleCandidate],
        2,
    );

    assert(selected.length === 2, `expected two selected candidates, got ${selected.length}`);
    assert(selected[0].className === "ChatView" && selected[0].methodName === "build", "caller-file build entry should be first");
    assert(selected[1].className === "ChatView" && selected[1].methodName === "aboutToAppear", "caller-file lifecycle should be second");
    assert(
        !selected.some(item => item.className === "UnrelatedPanel"),
        "unrelated high-frequency component must not displace caller-file entries",
    );

    console.log("PASS test_semanticflow_arkmain_candidate_selection");
}

main();
