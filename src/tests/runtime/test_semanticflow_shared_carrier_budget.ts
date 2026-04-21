import * as fs from "fs";
import * as path from "path";
import {
    enrichNoCandidateItemsWithCallsiteSlices,
    normalizeNoCandidateItem,
} from "../../core/model/callsite/callsiteContextSlices";
import { buildSemanticFlowRuleCandidateItem } from "../../core/semanticflow/SemanticFlowAdapters";
import { buildRuleCandidateCompanionGroups, semanticFlowRuleCandidateKey } from "../../core/semanticflow/SemanticFlowRuleCompanions";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function writeFixture(projectDir: string): void {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(projectDir, "entry", "src", "main", "ets", "carrier"), { recursive: true });
    fs.writeFileSync(path.join(projectDir, "entry", "src", "main", "ets", "carrier", "pool.ets"), [
        "const pool: string[] = [];",
        "const labels = new Map<string, string>();",
        "",
        "export function f1(value: string): void {",
        "  pool.push(value);",
        "  labels.set('last', value);",
        "}",
        "",
        "export function f2(): string | undefined {",
        "  return pool.pop();",
        "}",
        "",
        "export function f3(key: string): string | undefined {",
        "  return labels.get(key);",
        "}",
        "",
        "export function entry(seed: string): string | undefined {",
        "  f1(seed);",
        "  return f2();",
        "}",
        "",
    ].join("\n"), "utf8");
}

async function main(): Promise<void> {
    const projectDir = path.resolve("tmp/test_runs/runtime/semanticflow_shared_carrier_budget/latest/project");
    writeFixture(projectDir);

    const enriched = enrichNoCandidateItemsWithCallsiteSlices({
        repoRoot: projectDir,
        sourceDirs: ["entry/src/main/ets/carrier"],
        items: [
            normalizeNoCandidateItem({
                callee_signature: "@ets/carrier/pool.ets: f1(string)",
                method: "f1",
                invokeKind: "static",
                argCount: 1,
                sourceFile: "ets/carrier/pool.ets",
                count: 3,
            }),
            normalizeNoCandidateItem({
                callee_signature: "@ets/carrier/pool.ets: f2()",
                method: "f2",
                invokeKind: "static",
                argCount: 0,
                sourceFile: "ets/carrier/pool.ets",
                count: 3,
            }),
        ],
        maxItems: 2,
        maxExamplesPerItem: 1,
        contextRadius: 3,
        cfgNeighborRadius: 1,
    });

    const writeCandidate = enriched.find(item => item.method === "f1");
    const readCandidate = enriched.find(item => item.method === "f2");
    assert(writeCandidate, "expected f1 candidate");
    assert(readCandidate, "expected f2 candidate");
    assert(Array.isArray((readCandidate as any).carrierRoots), "expected carrier roots on read candidate");
    assert(((readCandidate as any).carrierRoots || []).includes("pool"), `expected pool carrier root, got ${JSON.stringify((readCandidate as any).carrierRoots || [])}`);
    assert(String((readCandidate as any).carrierSnippet || "").includes("const pool"), "expected carrier context snippet to include pool declaration");
    assert(Array.isArray((readCandidate as any).carrierMethodSnippets), "expected carrier sibling snippets");
    assert(((readCandidate as any).carrierMethodSnippets || []).some((entry: any) => entry?.method === "f1"), "expected f1 as shared-carrier companion");

    const groups = buildRuleCandidateCompanionGroups(enriched);
    const readCompanions = groups.get(semanticFlowRuleCandidateKey(readCandidate)) || [];
    assert(readCompanions.some(item => item.method === "f1"), "shared carrier grouping should pair f2 with f1");
    assert(!readCompanions.some(item => item.method === "f3"), "carrier grouping should not pull unrelated roots");

    const slice = buildSemanticFlowRuleCandidateItem(readCandidate, {
        maxContextSlices: 1,
        companionCandidates: readCompanions,
    }).initialSlice;
    const labels = slice.snippets.map(snippet => snippet.label);

    assert(slice.template === "multi-surface", `expected multi-surface template, got ${slice.template}`);
    assert(slice.observations.includes("carrierRoots=1"), `expected carrierRoots observation, got ${slice.observations.join(",")}`);
    assert(slice.observations.some(obs => obs.includes("carrierTouch=readwrite:pool.pop")), "expected pool.pop carrier touch observation");
    assert(labels.includes("method"), "expected method snippet for shared carrier body");
    assert(labels.includes("carrier-context"), "expected carrier-context snippet");
    assert(labels.includes("carrier-sibling-f1"), "expected carrier sibling snippet");
    assert((slice.companions || []).includes("f1"), "expected f1 companion in slice");
    assert(!(slice.companions || []).includes("f3"), "unexpected unrelated carrier companion");
    assert(writeCandidate.method === "f1", "fixture sanity");

    console.log("PASS test_semanticflow_shared_carrier_budget");
}

main().catch(error => {
    console.error("FAIL test_semanticflow_shared_carrier_budget");
    console.error(error);
    process.exit(1);
});
