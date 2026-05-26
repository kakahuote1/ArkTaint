import * as fs from "fs";
import * as path from "path";
import {
    writeNoCandidateCallsiteArtifacts,
    writeNoCandidateCallsiteClassificationArtifacts,
} from "../../cli/ruleFeedback";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function readJson<T>(filePath: string): T {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
}

function main(): void {
    const outputDir = path.resolve("tmp/test_runs/analyze/no_candidate_rule_feedback_artifacts/latest");
    fs.rmSync(outputDir, { recursive: true, force: true });
    fs.mkdirSync(outputDir, { recursive: true });

    const report: any = {
        generatedAt: "2026-04-13T00:00:00.000Z",
        repo: "D:/cursor/workplace/project/demo",
        summary: {
            transferProfile: {
                noCandidateCallsites: [
                    {
                        calleeSignature: "@ets/router/Router.ets: Router.[static]getParams()",
                        method: "getParams",
                        invokeKind: "static",
                        argCount: 0,
                        sourceFile: "ets/router/Router.ets",
                        count: 5,
                    },
                    {
                        calleeSignature: "@ets/pages/PersonInfo.ets: PersonInfo.saveUserName(string)",
                        method: "saveUserName",
                        invokeKind: "instance",
                        argCount: 1,
                        sourceFile: "ets/pages/PersonInfo.ets",
                        count: 8,
                    },
                    {
                        calleeSignature: "@ets/pages/Index.ets: Index.homeTabItemLayout(TabItem)",
                        method: "homeTabItemLayout",
                        invokeKind: "instance",
                        argCount: 1,
                        sourceFile: "ets/pages/Index.ets",
                        count: 6,
                    },
                    {
                        calleeSignature: "@ets/network/HttpClient.ets: HttpClient.post(string, Object)",
                        method: "post",
                        invokeKind: "instance",
                        argCount: 2,
                        sourceFile: "ets/network/HttpClient.ets",
                        count: 3,
                    },
                ],
            },
            ruleFeedback: {
                noCandidateCallsites: [],
            },
        },
    };

    const loadedRules: any = {
        ruleSet: {
            transfers: [],
        },
        appliedLayerOrder: [],
        layerStatus: [],
    };

    writeNoCandidateCallsiteArtifacts(report, outputDir);
    writeNoCandidateCallsiteClassificationArtifacts(report, loadedRules, outputDir);

    const feedbackDir = path.join(outputDir, "feedback", "rule_feedback");
    const raw = readJson<any>(path.join(feedbackDir, "no_candidate_callsites.json"));
    const classified = readJson<any>(path.join(feedbackDir, "no_candidate_callsites_classified.json"));
    const projectCandidates = readJson<any>(path.join(feedbackDir, "api_modeling_candidates.json"));

    assert(raw.total === 4, `expected raw.total=4, got ${raw.total}`);
    assert(raw.items.some((item: any) => item.callee_signature?.includes("Router.[static]getParams")), "expected raw candidate to come from transferProfile");
    assert(classified.total === 4, `expected classified.total=4, got ${classified.total}`);
    const saveUserName = classified.items.find((item: any) => item.method === "saveUserName");
    const layout = classified.items.find((item: any) => item.method === "homeTabItemLayout");
    const post = classified.items.find((item: any) => item.method === "post");
    assert(saveUserName?.category === "C0_NON_TRANSFER_HELPER", `expected page action helper to be downgraded, got ${saveUserName?.category}`);
    assert(layout?.category === "C0_NON_TRANSFER_HELPER", `expected page layout helper to be downgraded, got ${layout?.category}`);
    assert(post?.category === "C2_API_MODELING_CANDIDATE", `expected network wrapper to remain an API modeling candidate, got ${post?.category}`);
    assert(!projectCandidates.items.some((item: any) => item.method === "saveUserName" || item.method === "homeTabItemLayout"),
        "page orchestration helpers should not be sent to LLM project modeling");
    assert(projectCandidates.items.some((item: any) => item.method === "post"),
        "network wrapper should remain in the LLM API modeling candidate pool");

    console.log("PASS test_no_candidate_rule_feedback_artifacts");
}

try {
    main();
} catch (error) {
    console.error("FAIL test_no_candidate_rule_feedback_artifacts");
    console.error(error);
    process.exit(1);
}
