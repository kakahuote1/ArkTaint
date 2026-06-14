import * as fs from "fs";
import * as path from "path";
import {
    enrichNoCandidateItemsWithCallsiteSlices,
    normalizeNoCandidateItem,
} from "../../core/model/callsite/callsiteContextSlices";
import { buildSemanticFlowApiModelingCandidateItem } from "../../core/semanticflow/SemanticFlowAdapters";
import { buildRuleCandidateCompanionGroups, semanticFlowRuleCandidateKey } from "../../core/semanticflow/SemanticFlowRuleCompanions";
import { writeNoCandidateCallsiteClassificationArtifacts } from "../../cli/ruleFeedback";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function writeFixture(projectDir: string): void {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(projectDir, "entry", "src", "main", "ets", "carrier"), { recursive: true });
    fs.mkdirSync(path.join(projectDir, "entry", "src", "main", "ets", "network"), { recursive: true });
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
    fs.writeFileSync(path.join(projectDir, "entry", "src", "main", "ets", "network", "receiver.ets"), [
        "interface AuthConfig { username: string; password: string }",
        "",
        "export class ReceiverClient {",
        "  private config: AuthConfig;",
        "  private authHeaders: Record<string, string> = {};",
        "",
        "  constructor(config: AuthConfig) {",
        "    this.config = config;",
        "    this.authHeaders = this.buildAuthHeaders();",
        "  }",
        "",
        "  private buildAuthHeaders(): Record<string, string> {",
        "    return { Authorization: this.config.password };",
        "  }",
        "",
        "  public async warmup(): Promise<void> {",
        "    const localHeaders: Record<string, string> = {};",
        ...Array.from({ length: 54 }, (_, index) => `    localHeaders['X-Probe-${index}'] = '${index}';`),
        "    console.debug(localHeaders);",
        "  }",
        "",
        "  private async _request(",
        "    path: string,",
        "  ): Promise<void> {",
        "    const finalHeaders = {};",
        "    Object.assign(finalHeaders, this.authHeaders);",
        "    console.debug('headers', JSON.stringify(finalHeaders));",
        "  }",
        "}",
        "",
        "export class OtherReceiverClient {",
        "  private authHeaders: Record<string, string> = {};",
        "  stash(value: string): void {",
        "    this.authHeaders = { Authorization: value };",
        "  }",
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

    const slice = buildSemanticFlowApiModelingCandidateItem(readCandidate, {
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

    const receiverEnriched = enrichNoCandidateItemsWithCallsiteSlices({
        repoRoot: projectDir,
        sourceDirs: ["entry/src/main/ets/network"],
        items: [
            normalizeNoCandidateItem({
                callee_signature: "@ets/network/receiver.ets: ReceiverClient._request(string)",
                method: "_request",
                invokeKind: "instance",
                argCount: 1,
                sourceFile: "ets/network/receiver.ets",
                count: 1,
            }),
        ],
        maxItems: 1,
        maxExamplesPerItem: 1,
        contextRadius: 3,
        cfgNeighborRadius: 1,
    });
    const requestCandidate = receiverEnriched.find(item => item.method === "_request");
    assert(requestCandidate, "expected _request receiver-field candidate");
    assert(
        ((requestCandidate as any).carrierRoots || []).includes("this.authHeaders"),
        `expected this.authHeaders carrier root, got ${JSON.stringify((requestCandidate as any).carrierRoots || [])}`,
    );
    assert(
        ((requestCandidate as any).carrierRoots || []).includes("this.config"),
        `expected transitive this.config carrier root from buildAuthHeaders, got ${JSON.stringify((requestCandidate as any).carrierRoots || [])}`,
    );
    assert(
        ((requestCandidate as any).carrierMethodSnippets || []).some((entry: any) => entry?.method === "constructor"),
        "expected constructor as receiver-field carrier companion",
    );
    assert(
        ((requestCandidate as any).carrierMethodSnippets || []).some((entry: any) => entry?.method === "buildAuthHeaders"),
        "expected buildAuthHeaders as transitive receiver-field carrier companion",
    );
    assert(
        !((requestCandidate as any).carrierMethodSnippets || []).some((entry: any) => entry?.method === "stash"),
        "same-name receiver field from another owner must not be included",
    );
    assert(
        String((requestCandidate as any).carrierSnippet || "").includes("receiverCarrierOwner: ReceiverClient"),
        "expected receiver carrier owner context",
    );

    const requestSlice = buildSemanticFlowApiModelingCandidateItem(requestCandidate, {
        maxContextSlices: 1,
        companionCandidates: [],
    }).initialSlice;
    const requestLabels = requestSlice.snippets.map(snippet => snippet.label);
    assert(requestSlice.observations.includes("carrierRoots=2"), `expected two receiver carrier roots, got ${requestSlice.observations.join(",")}`);
    assert(
        requestSlice.observations.some(obs => obs.includes("carrierTouch=read:this.authHeaders.read")),
        `expected receiver-field read observation, got ${requestSlice.observations.join(",")}`,
    );
    assert(requestLabels.includes("carrier-context"), "expected receiver carrier-context snippet");
    assert(requestLabels.includes("carrier-sibling-constructor"), "expected constructor carrier sibling snippet");
    assert(requestLabels.includes("carrier-sibling-buildAuthHeaders"), "expected buildAuthHeaders carrier sibling snippet");

    const feedbackOut = path.resolve("tmp/test_runs/runtime/semanticflow_shared_carrier_budget/latest/feedback_artifacts");
    fs.rmSync(feedbackOut, { recursive: true, force: true });
    writeNoCandidateCallsiteClassificationArtifacts({
        generatedAt: new Date(0).toISOString(),
        repo: projectDir,
        sourceDirs: ["entry/src/main/ets"],
        summary: {
            transferProfile: {
                noCandidateCallsites: [],
            },
            ruleFeedback: {
                noCandidateCallsites: [],
            },
        },
    } as any, {
        ruleSet: {
            sources: [],
            sinks: [],
            transfers: [],
        },
    } as any, feedbackOut);
    const candidatePayload = JSON.parse(fs.readFileSync(
        path.join(feedbackOut, "feedback", "rule_feedback", "api_modeling_candidates.json"),
        "utf8",
    ));
    const artifactRequestCandidate = (candidatePayload.items || []).find((item: any) =>
        item.method === "_request" && String(item.sourceFile || "").endsWith("entry/src/main/ets/network/receiver.ets"),
    );
    assert(artifactRequestCandidate, "expected recalled _request candidate in feedback artifact");
    assert(
        ((artifactRequestCandidate as any).carrierRoots || []).includes("this.authHeaders"),
        `expected feedback artifact to preserve this.authHeaders carrier root, got ${JSON.stringify((artifactRequestCandidate as any).carrierRoots || [])}`,
    );
    assert(
        ((artifactRequestCandidate as any).carrierMethodSnippets || []).some((entry: any) => entry?.method === "buildAuthHeaders"),
        "expected feedback artifact to preserve buildAuthHeaders receiver-field companion",
    );

    console.log("PASS test_semanticflow_shared_carrier_budget");
}

main().catch(error => {
    console.error("FAIL test_semanticflow_shared_carrier_budget");
    console.error(error);
    process.exit(1);
});
