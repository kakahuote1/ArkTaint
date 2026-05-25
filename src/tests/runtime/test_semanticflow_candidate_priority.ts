import {
    rankSemanticFlowRuleCandidatesForModeling,
    scoreSemanticFlowRuleCandidateForModeling,
    semanticFlowCandidateBelongsToSourceDir,
} from "../../cli/semanticflow";
import { enrichNoCandidateItemsWithCallsiteSlices } from "../../core/model/callsite/callsiteContextSlices";
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

function main(): void {
    const observedNoCandidate = candidate({
        method: "updatePhone",
        count: 1,
        callee_signature: "@demo/entry/src/main/ets/viewmodel/LoginViewModel.ets: LoginViewModel.updatePhone(string)",
    });
    const proactiveUiSurface = candidate({
        method: "PhoneInputField",
        count: 25,
        callee_signature: "@%unk/%unk: .PhoneInputField()",
        sourceFile: "entry/src/main/ets/component/PhoneInputField.ets",
        candidateOrigin: "proactive_project_callback_surface",
    } as Partial<NormalizedCallsiteItem>);
    const networkWrapper = candidate({
        method: "request",
        count: 1,
        callee_signature: "@demo/core/network/NetworkClient.ets: NetworkClient.request(Object)",
        sourceFile: "core/network/NetworkClient.ets",
    });
    const proactiveAuthServiceWrapper = candidate({
        method: "getUserCredential",
        argCount: 1,
        count: 1,
        callee_signature: "@demo/entry/src/main/ets/configure/service.ets: Servicer.[static]getUserCredential(string)",
        sourceFile: "entry/src/main/ets/configure/service.ets",
        candidateOrigin: "proactive_project_api_wrapper_surface",
    } as Partial<NormalizedCallsiteItem>);
    const proactiveAuthResponseSource = candidate({
        method: "getUserCredential",
        argCount: 1,
        count: 1,
        callee_signature: "@demo/entry/src/main/ets/configure/service.ets: Servicer.[static]getUserCredential(string)",
        sourceFile: "entry/src/main/ets/configure/service.ets",
        candidateOrigin: "proactive_project_api_wrapper_source_surface",
        semanticFocus: "external_response_source",
    } as Partial<NormalizedCallsiteItem>);
    const contextRegistrationHelper = candidate({
        method: "registerAbilityStageContext",
        argCount: 1,
        count: 80,
        callee_signature: "@demo/entry/src/main/ets/configure/context.ets: CtxManager.[static]registerAbilityStageContext(AbilityStageContext)",
        sourceFile: "entry/src/main/ets/configure/context.ets",
        candidateOrigin: "proactive_project_api_wrapper_surface",
    } as Partial<NormalizedCallsiteItem>);
    const cleanupHelper = candidate({
        method: "delete",
        argCount: 0,
        count: 80,
        callee_signature: "@demo/entry/src/main/ets/configure/cache.ets: Cacher.delete()",
        sourceFile: "entry/src/main/ets/configure/cache.ets",
        candidateOrigin: "proactive_project_api_wrapper_surface",
    } as Partial<NormalizedCallsiteItem>);
    const serializerWrapper = candidate({
        method: "toNoteObject",
        argCount: 0,
        count: 2,
        callee_signature: "@demo/common/model/databaseModel/NoteData.ets: NoteData.toNoteObject()",
        sourceFile: "common/model/databaseModel/NoteData.ets",
    });
    const displayHelper = candidate({
        method: "getFolderText",
        argCount: 1,
        count: 4,
        callee_signature: "@demo/common/baseUtil/FolderUtil.ets: FolderUtil.getFolderText(FolderData)",
        sourceFile: "common/baseUtil/FolderUtil.ets",
    });

    assert(
        scoreSemanticFlowRuleCandidateForModeling(observedNoCandidate)
            > scoreSemanticFlowRuleCandidateForModeling(proactiveUiSurface),
        "observed no-candidate project callsites should outrank proactive UI surfaces when LLM budget is limited",
    );
    assert(
        scoreSemanticFlowRuleCandidateForModeling(networkWrapper)
            > scoreSemanticFlowRuleCandidateForModeling(proactiveUiSurface),
        "network/request wrappers discovered from actual analysis should not be crowded out by proactive UI surfaces",
    );
    assert(
        scoreSemanticFlowRuleCandidateForModeling(proactiveAuthServiceWrapper)
            > scoreSemanticFlowRuleCandidateForModeling(proactiveUiSurface),
        "proactive API/service wrappers should not be crowded out by UI callback surfaces when no taint seed reaches them yet",
    );
    assert(
        scoreSemanticFlowRuleCandidateForModeling(proactiveAuthResponseSource)
            > scoreSemanticFlowRuleCandidateForModeling(proactiveUiSurface),
        "focused external-response source candidates should not be crowded out by UI callback surfaces",
    );
    assert(
        scoreSemanticFlowRuleCandidateForModeling(proactiveAuthServiceWrapper)
            > scoreSemanticFlowRuleCandidateForModeling(contextRegistrationHelper),
        "credential/profile service wrappers should outrank context/window setup helpers even when setup helpers are frequent",
    );
    assert(
        scoreSemanticFlowRuleCandidateForModeling(proactiveAuthServiceWrapper)
            > scoreSemanticFlowRuleCandidateForModeling(cleanupHelper),
        "payload-bearing credential/profile wrappers should outrank no-payload cleanup helpers in LLM modeling budgets",
    );
    assert(
        scoreSemanticFlowRuleCandidateForModeling(serializerWrapper)
            > scoreSemanticFlowRuleCandidateForModeling(displayHelper),
        "object/params serialization wrappers should be modeled before display helpers because they preserve payload fields into sink objects",
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
    const crowdedCandidates = Array.from({ length: 50 }, (_, index) => candidate({
        method: `PhoneInputField${index}`,
        count: 10,
        callee_signature: `@%unk/%unk: .PhoneInputField${index}()`,
        sourceFile: `entry/src/main/ets/component/PhoneInputField${index}.ets`,
        candidateOrigin: "proactive_project_callback_surface",
    } as Partial<NormalizedCallsiteItem>));
    crowdedCandidates.push(observedNoCandidate);
    assert(
        rankSemanticFlowRuleCandidatesForModeling(crowdedCandidates)[0].method === "updatePhone",
        "context enrichment budgets should be applied after modeling-value ranking, otherwise real no-candidate callsites lose method bodies",
    );
    const enrichedBudgetProbe = enrichNoCandidateItemsWithCallsiteSlices({
        repoRoot: "D:/workspace/nonexistent",
        sourceDirs: ["entry/src/main/ets"],
        items: [observedNoCandidate, proactiveUiSurface],
        maxItems: 1,
        maxExamplesPerItem: 1,
        contextRadius: 1,
        cfgNeighborRadius: 1,
    });
    assert(
        enrichedBudgetProbe[0].contextError === "no_scene_built_for_sourceDirs"
            && enrichedBudgetProbe[1].contextError === undefined,
        "callsite enrichment should preserve caller-selected priority order instead of re-sorting by observed count",
    );

    console.log("PASS test_semanticflow_candidate_priority");
}

main();
