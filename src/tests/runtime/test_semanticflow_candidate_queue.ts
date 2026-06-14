import {
    buildSemanticFlowRuleCandidateModelingQueue,
    orderSemanticFlowRuleCandidatesForModeling,
    selectSemanticFlowRuleCandidatesForModeling,
    semanticFlowCandidateBelongsToSourceDir,
} from "../../cli/semanticflow";
import type { NormalizedCallsiteItem } from "../../core/model/callsite/callsiteContextSlices";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function candidate(partial: Partial<NormalizedCallsiteItem>): NormalizedCallsiteItem {
    return {
        callee_signature: partial.callee_signature || "@demo/entry/src/main/ets/viewmodel/LoginViewModel.ets: LoginViewModel.updatePhone(string)",
        method: partial.method || "updatePhone",
        invokeKind: partial.invokeKind || "instance",
        argCount: partial.argCount ?? 1,
        sourceFile: partial.sourceFile || "entry/src/main/ets/viewmodel/LoginViewModel.ets",
        count: partial.count,
        ...(partial as Record<string, unknown>),
    };
}

function methodList(items: NormalizedCallsiteItem[]): string[] {
    return items.map(item => String(item.method || ""));
}

function main(): void {
    const earlyUiHelper = candidate({
        method: "showToast",
        count: 900,
        callee_signature: "@demo/entry/src/main/ets/pages/SearchServices.ets: SearchServices.showToast(string)",
        sourceFile: "entry/src/main/ets/pages/SearchServices.ets",
    });
    const middleNetworkWrapper = candidate({
        method: "makeRequest",
        count: 20,
        callee_signature: "@demo/entry/src/main/ets/services/search/SearchService.ets: SearchService.makeRequest(string, RequestOptions)",
        sourceFile: "entry/src/main/ets/services/search/SearchService.ets",
        candidateOrigin: "recall_api_surface",
        methodSnippet: "return this.httpClient.request(url, options);",
        topEntries: ["candidateBoundary=project_or_third_party_wrapper_evidence"],
    } as Partial<NormalizedCallsiteItem>);
    const lateLoggerWrapper = candidate({
        method: "logToConsole",
        count: 1,
        callee_signature: "@demo/entry/src/main/ets/services/WebDavLogger.ets: WebDavLogger.logToConsole(LogEntry)",
        sourceFile: "entry/src/main/ets/services/WebDavLogger.ets",
        candidateOrigin: "recall_api_surface",
        methodSnippet: "console.info(JSON.stringify(log.data));",
        topEntries: ["candidateBoundary=project_or_third_party_wrapper_evidence"],
    } as Partial<NormalizedCallsiteItem>);
    const unresolvedSurface = candidate({
        method: "",
        callee_signature: "@%unk/%unk: .%unk()",
        sourceFile: "entry/src/main/ets/pages/Unknown.ets",
        candidateOrigin: "recall_api_surface",
    } as Partial<NormalizedCallsiteItem>);

    const candidates = [
        earlyUiHelper,
        middleNetworkWrapper,
        lateLoggerWrapper,
        unresolvedSurface,
    ];
    const queue = buildSemanticFlowRuleCandidateModelingQueue(candidates, 2);
    assert(queue.deferred.length === 0, "SemanticFlow queue must not discard candidates as deferred-budget");
    assert(
        methodList(queue.selected.map(entry => entry.item)).join(",") === "showToast,makeRequest,logToConsole",
        "all modelable candidates should stay selected in discovery order instead of score-prioritized order",
    );
    assert(
        queue.selected.map(entry => entry.batchIndex).join(",") === "0,0,1",
        "maxLlmItems should be interpreted as batch size for selected candidates",
    );
    assert(
        queue.needMoreEvidence.length === 1 && queue.needMoreEvidence[0].item === unresolvedSurface,
        "identity-unresolved surfaces should be separated as need-more-evidence, not silently selected or discarded",
    );

    const selected = selectSemanticFlowRuleCandidatesForModeling(candidates, 1);
    assert(
        methodList(selected).join(",") === "showToast,makeRequest,logToConsole",
        "selectSemanticFlowRuleCandidatesForModeling should return every modelable candidate even when batch size is one",
    );
    assert(
        methodList(orderSemanticFlowRuleCandidatesForModeling(candidates)).join(",") === "showToast,makeRequest,logToConsole,",
        "context-enrichment ordering should preserve scanner discovery order and must not reintroduce scoring",
    );

    assert(
        semanticFlowCandidateBelongsToSourceDir(
            "feature/auth/src/main/ets",
            "D:/workspace/CoolMallArkTS/feature/auth/src/main/ets",
            candidate({
                sourceFile: "CoolMallArkTS/feature/auth/src/main/ets/viewmodel/LoginViewModel.ets",
            }),
        ),
        "sourceDir filtering should accept analyzer paths prefixed by the project root directory name",
    );
    assert(
        semanticFlowCandidateBelongsToSourceDir(
            "entry/src/main/ets/components",
            "D:/workspace/Aigis/entry/src/main/ets/components",
            candidate({
                sourceFile: "components/dialog.ets",
            }),
        ),
        "sourceDir filtering should accept analyzer paths reported relative to the ETS source root",
    );
}

main();
