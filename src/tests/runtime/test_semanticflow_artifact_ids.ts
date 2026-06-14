import * as fs from "fs";
import * as path from "path";
import { validateAssetDocument, type AssetDocumentBase } from "../../core/assets/schema";
import { buildSemanticFlowAnalysisAugmentFromAssets, stabilizeSemanticFlowItemsForAugment } from "../../core/semanticflow/SemanticFlowArtifacts";
import { publishSemanticFlowProjectAssets } from "../../core/semanticflow/SemanticFlowProjectAssets";
import type { SemanticFlowItemResult } from "../../core/semanticflow/SemanticFlowTypes";
import { serializeSemanticFlowAssets } from "../../core/semanticflow/SemanticFlowSerialize";
import { assert, expectThrows, makeHandoffAsset, makeRuleAsset } from "./SemanticFlowV2TestHelpers";

function main(): void {
    const asset = makeRuleAsset("asset.project.logger.sink");
    const augment = buildSemanticFlowAnalysisAugmentFromAssets([asset, asset]);
    assert(augment.assets.length === 1, "semanticflow assets should dedupe by plane and id");
    const serialized = serializeSemanticFlowAssets(augment);
    assert(serialized[0].id === asset.id, "serialized asset should preserve id");
    assert(serialized[0].bindings[0].effectTemplateRefs?.[0] === "asset.project.logger.sink.effect", "binding must point to effect template");

    const sourceOnly = makeRuleAsset("project.RequestUtil.commonRequest", {
        role: "source",
        effectKind: "rule.source",
        bindingId: "binding.RequestUtil.commonRequest.source",
        effectId: "template.RequestUtil.commonRequest.source",
    });
    const sinkAndSource = makeRuleAsset("project.RequestUtil.commonRequest", {
        role: "sink",
        effectKind: "rule.sink",
        bindingId: "binding.RequestUtil.commonRequest.sink.config",
        effectId: "template.RequestUtil.commonRequest.sink",
    });
    const merged = buildSemanticFlowAnalysisAugmentFromAssets([sourceOnly, sinkAndSource]);
    assert(merged.assets.length === 1, "same semanticflow asset id should merge into one multi-role asset");
    const roles = new Set(merged.assets[0].bindings.map(binding => binding.role));
    const kinds = new Set((merged.assets[0].effectTemplates || []).map(effect => effect.kind));
    assert(roles.has("source"), "merged asset should preserve source binding");
    assert(roles.has("sink"), "merged asset should preserve sink binding");
    assert(kinds.has("rule.source"), "merged asset should preserve source effect template");
    assert(kinds.has("rule.sink"), "merged asset should preserve sink effect template");
    assert(merged.assets[0].bindings.filter(binding => binding.role === "source").length === 1, "equivalent source bindings should dedupe");
    assert(merged.assets[0].bindings.filter(binding => binding.role === "sink").length === 1, "sink binding should remain after equivalent source dedupe");

    const sparse = makeHandoffAsset("project.RelationalStoreUtils.updateSong");
    sparse.bindings[0].bindingId = "binding.RelationalStoreUtils.updateSong.handoffPut";
    sparse.effectTemplates![0].id = "template.RelationalStoreUtils.updateSong.put";
    sparse.bindings[0].effectTemplateRefs = ["template.RelationalStoreUtils.updateSong.put"];
    sparse.bindings[0] = {
        ...sparse.bindings[0],
        semanticsFamily: undefined,
    };
    const enriched = makeHandoffAsset("project.RelationalStoreUtils.updateSong");
    enriched.bindings[0].bindingId = "binding.RelationalStoreUtils.updateSong.handoffPut";
    enriched.effectTemplates![0].id = "template.RelationalStoreUtils.updateSong.put";
    enriched.bindings[0].effectTemplateRefs = ["template.RelationalStoreUtils.updateSong.put"];
    enriched.bindings[0] = {
        ...enriched.bindings[0],
        semanticsFamily: "project.relationalsongs",
    };
    const enrichedMerge = buildSemanticFlowAnalysisAugmentFromAssets([sparse, enriched]);
    assert(enrichedMerge.assets.length === 1, "compatible duplicate binding ids should merge");
    assert(
        enrichedMerge.assets[0].bindings[0].semanticsFamily === "project.relationalsongs",
        "compatible duplicate binding should preserve the richer semantics family",
    );

    const sameIdSource = makeRuleAsset("project.RdbDao.delete", {
        role: "source",
        effectKind: "rule.source",
        bindingId: "binding.RdbDao.delete.source",
        effectId: "template.RdbDao.delete.kill",
    });
    const sameIdSink = makeRuleAsset("project.RdbDao.delete", {
        role: "sink",
        effectKind: "rule.sink",
        bindingId: "binding.RdbDao.delete.sink",
        effectId: "template.RdbDao.delete.kill",
    });
    expectThrows(
        () => buildSemanticFlowAnalysisAugmentFromAssets([sameIdSource, sameIdSink]),
        "semanticflow asset merge conflict",
    );
    const stabilized = stabilizeSemanticFlowItemsForAugment([
        makeItem("source-delete", sameIdSource),
        makeItem("sink-delete", sameIdSink),
    ]);
    assert(stabilized.augment.assets.length === 1, "item-level stabilization should keep the first compatible asset");
    assert(stabilized.conflicts.length === 1, "item-level stabilization should report one generated-asset conflict");
    assert(stabilized.items[0].resolution === "resolved", "first generated item should remain resolved");
    assert(stabilized.items[1].resolution === "need-human-check", "conflicting generated item should be isolated for human check");
    assert(!stabilized.items[1].asset, "conflicting item must not enter the analysis augment");
    assert(
        String(stabilized.items[1].error || "").includes("semanticflow generated asset excluded from augment"),
        "conflicting item should preserve a durable diagnostic",
    );

    const listenerPut = makeListenerHandoffAsset({
        id: "project.WebDavManager.addLogListener",
        methodName: "addLogListener",
        templateId: "template.WebDavManager.addLogListener.put",
        bindingId: "binding.WebDavManager.addLogListener.put",
        kind: "handoff.put",
        family: "project.webdav.logger",
    });
    const listenerKill = makeListenerHandoffAsset({
        id: "project.WebDavManager.removeLogListener",
        methodName: "removeLogListener",
        templateId: "template.WebDavManager.removeLogListener.kill",
        bindingId: "binding.WebDavManager.removeLogListener.kill",
        kind: "handoff.kill",
        family: "project.webdav.logListeners",
    });
    const publishRoot = path.join("tmp", "test_runs", "semanticflow_artifact_ids", "paired_family_publish");
    fs.rmSync(publishRoot, { recursive: true, force: true });
    const published = publishSemanticFlowProjectAssets({
        projectId: "semanticflow",
        modelRoot: publishRoot,
        assets: [listenerPut, listenerKill],
    });
    assert(published.modulePath, "paired listener module asset should be published");
    const publishedModule = JSON.parse(fs.readFileSync(published.modulePath!, "utf8")) as AssetDocumentBase;
    const publishedValidation = validateAssetDocument(publishedModule);
    assert(publishedValidation.valid, `published aggregate module asset should validate: ${publishedValidation.errors.join("; ")}`);
    const listenerFamilies = new Set((publishedModule.effectTemplates || []).map(template => String((template as any).handle?.family || "")));
    assert(listenerFamilies.size === 1, "published paired listener handoff templates should use one canonical family");

    console.log("PASS test_semanticflow_artifact_ids");
}

function makeListenerHandoffAsset(input: {
    id: string;
    methodName: string;
    templateId: string;
    bindingId: string;
    kind: "handoff.put" | "handoff.kill";
    family: string;
}): AssetDocumentBase {
    const asset = makeHandoffAsset(input.id) as any;
    asset.surfaces[0] = {
        surfaceId: `${input.id}.surface`,
        kind: "invoke",
        modulePath: "entry/src/main/ets/common/utils/webdav/manager.ts",
        ownerName: "WebDavManager",
        methodName: input.methodName,
        invokeKind: "instance",
        argCount: 1,
        confidence: "likely",
        provenance: {
            source: "llm-proposal",
            location: { file: "entry/src/main/ets/common/utils/webdav/manager.ts", line: 1 },
        },
    };
    asset.bindings[0] = {
        bindingId: input.bindingId,
        surfaceId: `${input.id}.surface`,
        assetId: input.id,
        plane: "module",
        role: "handoff",
        endpoint: { base: { kind: "arg", index: 0 } },
        effectTemplateRefs: [input.templateId],
        semanticsFamily: "callback-context-slot",
        completeness: "partial",
        confidence: "likely",
    };
    const handle = {
        cellKind: "callback-context-slot",
        family: input.family,
        key: [{ kind: "fromEndpoint", endpoint: { base: { kind: "arg", index: 0 } } }],
        precision: "infer",
    };
    asset.effectTemplates = input.kind === "handoff.put"
        ? [{
            id: input.templateId,
            kind: "handoff.put",
            handle,
            value: { base: { kind: "arg", index: 0 } },
            updateStrength: "infer",
            confidence: "likely",
        }]
        : [{
            id: input.templateId,
            kind: "handoff.kill",
            handle,
            updateStrength: "infer",
            confidence: "likely",
        }];
    return asset as AssetDocumentBase;
}

function makeItem(anchorId: string, asset: ReturnType<typeof makeRuleAsset>): SemanticFlowItemResult {
    return {
        anchor: {
            id: anchorId,
            surface: anchorId,
        },
        draftId: `${anchorId}.draft`,
        plane: asset.plane,
        resolution: "resolved",
        asset,
        finalSlice: {
            anchorId,
            round: 0,
            template: "multi-surface",
            observations: [],
            snippets: [],
        },
        history: [],
    };
}

main();
