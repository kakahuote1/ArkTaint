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

    assert(raw.total === 1, `expected raw.total=1, got ${raw.total}`);
    assert(raw.items[0]?.callee_signature?.includes("Router.[static]getParams"), "expected raw candidate to come from transferProfile");
    assert(classified.total === 1, `expected classified.total=1, got ${classified.total}`);

    console.log("PASS test_no_candidate_rule_feedback_artifacts");
}

try {
    main();
} catch (error) {
    console.error("FAIL test_no_candidate_rule_feedback_artifacts");
    console.error(error);
    process.exit(1);
}
