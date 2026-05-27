import * as fs from "fs";
import * as path from "path";
import { buildSemanticFlowItemCacheKey, SemanticFlowSessionCache } from "../../core/semanticflow/SemanticFlowSessionCache";
import type { SemanticFlowItemResult, SemanticFlowSlicePackage } from "../../core/semanticflow/SemanticFlowTypes";
import { assert, makeRuleAsset } from "./SemanticFlowV2TestHelpers";

function slice(): SemanticFlowSlicePackage {
    return {
        anchorId: "anchor:Logger.info",
        round: 0,
        template: "call-return",
        observations: ["surface proposal requires analyzer evidence"],
        snippets: [{ label: "callsite", code: "Logger.info(token)" }],
    };
}

function main(): void {
    const rootDir = path.resolve("tmp/test_runs/runtime/semanticflow_v2_session_cache");
    fs.rmSync(rootDir, { recursive: true, force: true });
    const cache = new SemanticFlowSessionCache({ rootDir, mode: "rw" });
    const anchor = { id: "anchor:Logger.info", surface: "Logger.info" };
    const key = buildSemanticFlowItemCacheKey({
        model: "mimo-v2.5-pro",
        temperature: 0,
        promptSchemaVersion: 1,
        parserSchemaVersion: 1,
        semanticsFingerprint: "v2-assets",
        anchor,
        initialSlice: slice(),
        maxRounds: 1,
    });
    const item: SemanticFlowItemResult = {
        anchor,
        draftId: "draft",
        plane: "rule",
        resolution: "resolved",
        asset: makeRuleAsset(),
        finalSlice: slice(),
        history: [],
    };
    cache.storeItem(key, item);
    const restored = cache.lookupItem(key);
    assert(restored?.asset?.id === item.asset?.id, "cache should preserve v2 asset");
    assert(restored?.plane === "rule", "cache should preserve plane");
    assert(!("classification" in restored!), "cache item must not contain old classification");
    console.log("PASS test_semanticflow_llm_session_cache");
}

main();
