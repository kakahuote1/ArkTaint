import type { AssetDocumentBase, CoverageLedgerEntry, ObservedSurface } from "../../core/assets/schema";
import { buildPreAnalysisEvidencePack } from "../../core/preanalysis";
import { buildSemanticFlowRunRecord } from "../../core/semanticflow/SemanticFlowRunRecord";
import { selectSemanticFlowSlicesFromEvidencePack } from "../../core/semanticflow/SemanticFlowSliceSelector";
import type { SemanticFlowRunResult } from "../../core/semanticflow/SemanticFlowTypes";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function expectThrows(fn: () => unknown, contains: string): void {
    try {
        fn();
    } catch (error) {
        const message = String((error as any)?.message || error);
        assert(message.includes(contains), `expected "${contains}", got "${message}"`);
        return;
    }
    throw new Error(`expected error containing "${contains}"`);
}

const observed: ObservedSurface[] = [
    {
        observedSurfaceId: "obs.known",
        rawKind: "call",
        location: { file: "Known.ets", line: 1 },
        analyzerEvidence: { calleeSignature: "@ohos/hilog: hilog.info(number,string,string,string)", argCount: 4 },
        resolutionStatus: "resolved",
    },
    {
        observedSurfaceId: "obs.unknown",
        rawKind: "call",
        location: { file: "TokenCache.ets", line: 2 },
        analyzerEvidence: { calleeSignature: "@project/cache: TokenCache.save(string,string)", argCount: 2 },
        resolutionStatus: "resolved",
    },
];

const entries: CoverageLedgerEntry[] = [
    {
        observedSurfaceId: "obs.known",
        coverageStatus: "covered-exact-role",
        decision: "skip-llm",
        matchedAssetIds: ["asset.official.hilog"],
        matchedBindingIds: ["binding.official.hilog.info"],
        reason: "official logging sink is covered by reviewed registry asset",
    },
    {
        observedSurfaceId: "obs.unknown",
        coverageStatus: "not-covered",
        decision: "send-to-llm",
        matchedAssetIds: [],
        reason: "project TokenCache surface has no trusted binding",
    },
];

function generatedAsset(): AssetDocumentBase {
    return {
        id: "asset.project.token-cache",
        plane: "module",
        status: "llm-generated",
        surfaces: [
            {
                surfaceId: "surface.TokenCache.save",
                kind: "invoke",
                modulePath: "project/cache",
                ownerName: "TokenCache",
                methodName: "save",
                invokeKind: "static",
                argCount: 2,
                confidence: "likely",
                provenance: { source: "llm-proposal", location: { file: "TokenCache.ets", line: 2 } },
            },
        ],
        bindings: [
            {
                bindingId: "binding.TokenCache.save",
                surfaceId: "surface.TokenCache.save",
                assetId: "asset.project.token-cache",
                plane: "module",
                role: "handoff",
                effectTemplateRefs: ["template.TokenCache.save.put"],
                completeness: "partial",
                confidence: "likely",
            },
        ],
        effectTemplates: [
            {
                id: "template.TokenCache.save.put",
                kind: "handoff.put",
                handle: {
                    cellKind: "keyed-semantic-slot",
                    family: "project.token_cache",
                    key: [{ kind: "fromLiteralArg", index: 0 }],
                },
                value: { base: { kind: "arg", index: 1 } },
                updateStrength: "infer",
                confidence: "likely",
            },
        ],
        provenance: { source: "llm", projectId: "demo" },
    };
}

function main(): void {
    const pack = buildPreAnalysisEvidencePack({
        projectId: "demo",
        runId: "run.phase4",
        observedSurfaces: observed,
        ledgerEntries: entries,
        semanticFlowSlicePackages: [
            {
                slicePackageId: "slice.unknown",
                observedSurfaceId: "obs.unknown",
                anchorId: "anchor.unknown",
                observations: ["TokenCache.save writes a value under a project key."],
                snippets: [{ label: "TokenCache.save", code: "TokenCache.save('token', value)" }],
            },
        ],
    });
    const selections = selectSemanticFlowSlicesFromEvidencePack(pack);
    assert(selections.length === 1, "expected exactly one LLM-selected slice");
    assert(selections[0].ledgerEntryId === "ledger.obs.unknown", "selector must preserve ledger entry identity");
    assert(selections[0].item.initialSlice.observations[0].includes("TokenCache.save"), "selector must use preanalysis evidence");

    const badPack = buildPreAnalysisEvidencePack({
        projectId: "demo",
        runId: "run.phase4.bad",
        observedSurfaces: observed,
        ledgerEntries: entries,
    }) as any;
    badPack.semanticFlowSlicePackages = [{
        slicePackageId: "slice.bad",
        observedSurfaceId: "obs.known",
        anchorId: "anchor.bad",
        observations: ["covered official sink"],
        snippets: [],
    }];
    expectThrows(() => selectSemanticFlowSlicesFromEvidencePack(badPack), "cannot be selected");

    const run: SemanticFlowRunResult = {
        items: [
            {
                anchor: selections[0].item.anchor,
                draftId: "draft.unknown",
                plane: "module",
                resolution: "resolved",
                asset: generatedAsset(),
                finalSlice: selections[0].item.initialSlice,
                history: [],
            },
            {
                anchor: { id: "anchor.rejected", surface: "RejectedApi" },
                draftId: "draft.rejected",
                resolution: "rejected",
                finalSlice: selections[0].item.initialSlice,
                history: [],
                error: "irrelevant",
            },
        ],
    };
    const record = buildSemanticFlowRunRecord(pack, run, [{
        assetId: "asset.project.token-cache",
        fromStatus: "llm-generated",
        accepted: false,
        reason: "promotion is a separate gate",
    }]);
    assert(record.inputLedgerId === "demo:run.phase4:coverage-ledger", "run record must link input ledger");
    assert(record.generatedAssetIds.includes("asset.project.token-cache"), "run record must list generated asset");
    assert(record.rejectedCandidateIds.includes("anchor.rejected"), "run record must list rejected candidates");
    assert(record.promotionResults[0].accepted === false, "run record must keep promotion outcome separate");

    console.log("PASS test_semanticflow_evidence_pack_contract");
}

main();
