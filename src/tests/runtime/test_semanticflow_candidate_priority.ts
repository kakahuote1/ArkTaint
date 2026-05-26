import {
    rankSemanticFlowRuleCandidatesForModeling,
    scoreSemanticFlowRuleCandidateForModeling,
    selectSemanticFlowRuleCandidatesForModeling,
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
    const recalledUiSurface = candidate({
        method: "PhoneInputField",
        count: 25,
        callee_signature: "@%unk/%unk: .PhoneInputField()",
        sourceFile: "entry/src/main/ets/component/PhoneInputField.ets",
        candidateOrigin: "recall_callback_surface",
    } as Partial<NormalizedCallsiteItem>);
    const networkWrapper = candidate({
        method: "request",
        count: 1,
        callee_signature: "@demo/core/network/NetworkClient.ets: NetworkClient.request(Object)",
        sourceFile: "core/network/NetworkClient.ets",
    });
    const recalledAuthServiceWrapper = candidate({
        method: "getUserCredential",
        argCount: 1,
        count: 1,
        callee_signature: "@demo/entry/src/main/ets/configure/service.ets: Servicer.[static]getUserCredential(string)",
        sourceFile: "entry/src/main/ets/configure/service.ets",
        candidateOrigin: "recall_api_surface",
    } as Partial<NormalizedCallsiteItem>);
    const recalledAuthResponseSource = candidate({
        method: "getUserCredential",
        argCount: 1,
        count: 1,
        callee_signature: "@demo/entry/src/main/ets/configure/service.ets: Servicer.[static]getUserCredential(string)",
        sourceFile: "entry/src/main/ets/configure/service.ets",
        candidateOrigin: "recall_returned_value_surface",
        semanticFocus: "returned_value_surface",
    } as Partial<NormalizedCallsiteItem>);
    const recalledTokenStoreReturn = candidate({
        method: "loadToken",
        argCount: 0,
        count: 1,
        callee_signature: "@demo/core/data/repository/TokenStoreRepository.ets: TokenStoreRepository.loadToken()",
        sourceFile: "core/data/repository/TokenStoreRepository.ets",
        candidateOrigin: "recall_returned_value_surface",
        semanticFocus: "returned_value_surface",
        methodSnippet: "loadToken(): Promise<string> {\n  return this.dataSource.getToken();\n}",
    } as Partial<NormalizedCallsiteItem>);
    const contextRegistrationHelper = candidate({
        method: "registerAbilityStageContext",
        argCount: 1,
        count: 80,
        callee_signature: "@demo/entry/src/main/ets/configure/context.ets: CtxManager.[static]registerAbilityStageContext(AbilityStageContext)",
        sourceFile: "entry/src/main/ets/configure/context.ets",
        candidateOrigin: "recall_api_surface",
    } as Partial<NormalizedCallsiteItem>);
    const cleanupHelper = candidate({
        method: "delete",
        argCount: 0,
        count: 80,
        callee_signature: "@demo/entry/src/main/ets/configure/cache.ets: Cacher.delete()",
        sourceFile: "entry/src/main/ets/configure/cache.ets",
        candidateOrigin: "recall_api_surface",
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
            > scoreSemanticFlowRuleCandidateForModeling(recalledUiSurface),
        "observed no-candidate callsites should outrank recalled UI surfaces when LLM budget is limited",
    );
    assert(
        scoreSemanticFlowRuleCandidateForModeling(networkWrapper)
            > scoreSemanticFlowRuleCandidateForModeling(recalledUiSurface),
        "network/request wrappers discovered from actual analysis should not be crowded out by recalled UI surfaces",
    );
    assert(
        scoreSemanticFlowRuleCandidateForModeling(recalledAuthServiceWrapper)
            > scoreSemanticFlowRuleCandidateForModeling(recalledUiSurface),
        "recalled API/service wrappers should not be crowded out by UI callback surfaces when no taint seed reaches them yet",
    );
    assert(
        scoreSemanticFlowRuleCandidateForModeling(recalledAuthResponseSource)
            > scoreSemanticFlowRuleCandidateForModeling(recalledUiSurface),
        "focused returned-value candidates should not be crowded out by UI callback surfaces",
    );
    assert(
        scoreSemanticFlowRuleCandidateForModeling(recalledTokenStoreReturn)
            > scoreSemanticFlowRuleCandidateForModeling(recalledUiSurface),
        "sensitive delegated returned-value candidates should not be crowded out by UI callback surfaces",
    );
    assert(
        scoreSemanticFlowRuleCandidateForModeling(recalledAuthServiceWrapper)
            > scoreSemanticFlowRuleCandidateForModeling(contextRegistrationHelper),
        "credential/profile service wrappers should outrank context/window setup helpers even when setup helpers are frequent",
    );
    assert(
        scoreSemanticFlowRuleCandidateForModeling(recalledAuthServiceWrapper)
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
        candidateOrigin: "recall_callback_surface",
    } as Partial<NormalizedCallsiteItem>));
    crowdedCandidates.push(observedNoCandidate);
    assert(
        rankSemanticFlowRuleCandidatesForModeling(crowdedCandidates)[0].method === "updatePhone",
        "context enrichment budgets should be applied after modeling-value ranking, otherwise real no-candidate callsites lose method bodies",
    );
    const pairedBudget = selectSemanticFlowRuleCandidatesForModeling([
        recalledAuthResponseSource,
        recalledAuthServiceWrapper,
        candidate({
            method: "getOtherProfile",
            argCount: 1,
            callee_signature: "@demo/entry/src/main/ets/configure/service.ets: Servicer.[static]getOtherProfile(string)",
            sourceFile: "entry/src/main/ets/configure/service.ets",
            candidateOrigin: "recall_returned_value_surface",
            semanticFocus: "returned_value_surface",
        } as Partial<NormalizedCallsiteItem>),
    ], 2);
    assert(
        pairedBudget.length === 2
            && pairedBudget.some(item => (item as any).semanticFocus === "returned_value_surface")
            && pairedBudget.some(item => !(item as any).semanticFocus),
        "dual-role wrapper budgeting should keep the ordinary request candidate paired with its external-response focused candidate",
    );
    const enrichedBudgetProbe = enrichNoCandidateItemsWithCallsiteSlices({
        repoRoot: "D:/workspace/nonexistent",
        sourceDirs: ["entry/src/main/ets"],
        items: [observedNoCandidate, recalledUiSurface],
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
