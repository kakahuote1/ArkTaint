import { parseSemanticFlowAssetModelOutput } from "../../core/semanticflow/SemanticFlowAssetModelOutput";
import { assert, expectThrows, makeRuleAsset } from "./SemanticFlowV2TestHelpers";

function main(): void {
    const guarded = makeRuleAsset("asset.project.http.request");
    if (guarded.surfaces[0].kind === "invoke") {
        guarded.surfaces[0].ownerName = "HttpClient";
        guarded.surfaces[0].methodName = "request";
    }
    guarded.bindings[0].endpoint = {
        base: { kind: "arg", index: 0 },
        accessPath: ["body"],
    };
    guarded.bindings[0].guard = {
        conditions: [
            {
                kind: "option-exists",
                path: ["body"],
            },
        ],
    };
    const parsed = parseSemanticFlowAssetModelOutput(JSON.stringify({ status: "done", asset: guarded }));
    assert(parsed.status === "done", "guarded v2 asset should parse");
    assert(parsed.asset.bindings[0].guard?.conditions?.[0]?.kind === "option-exists", "expected structured guard");

    const legacy = JSON.parse(JSON.stringify({ status: "done", asset: guarded }));
    legacy.asset.bindings[0].semanticsRef = "old";
    expectThrows(() => parseSemanticFlowAssetModelOutput(JSON.stringify(legacy)), "semanticsRef");

    console.log("PASS testSemanticFlowGuards");
}

main();
