import * as fs from "fs";
import * as path from "path";
import {
    readAnalyzeSummary,
    runAnalyzeCli,
} from "./helpers/AnalyzeCliRunner";

interface ClassifiedItem {
    category: string;
    callee_signature: string;
}

interface ClassifiedPayload {
    total: number;
    items: ClassifiedItem[];
}

interface ProjectCandidatePayload {
    total: number;
    policy: string;
    items: ClassifiedItem[];
}

interface AnalyzeSummary {
    summary: {
        ruleFeedback?: {
            noCandidateCallsites?: any[];
        };
    };
}

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function readJson<T>(filePath: string): T {
    if (!fs.existsSync(filePath)) {
        throw new Error(`missing json: ${filePath}`);
    }
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
}

function main(): void {
    const outputDir = path.resolve("tmp/analyze/no_candidate_project_candidate_pool");
    fs.rmSync(outputDir, { recursive: true, force: true });
    fs.mkdirSync(outputDir, { recursive: true });

    runAnalyzeCli([
        "--repo", "tests/demo/complex_calls",
        "--sourceDir", ".",
        "--profile", "default",
        "--maxEntries", "12",
        "--no-incremental",
        "--outputDir", outputDir,
    ]);

    const summary = readAnalyzeSummary<AnalyzeSummary>(outputDir);
    const classifiedPath = path.resolve("tmp/real_projects/no_candidate_callsites_classified.json");
    const projectCandidatePath = path.resolve("tmp/real_projects/no_candidate_project_candidates.json");
    const classified = readJson<ClassifiedPayload>(classifiedPath);
    const projectCandidates = readJson<ProjectCandidatePayload>(projectCandidatePath);
    const summaryNoCandidate = summary.summary.ruleFeedback?.noCandidateCallsites || [];

    assert(classified.total === classified.items.length, "classified total/items mismatch");
    assert(projectCandidates.total === projectCandidates.items.length, "project candidate total/items mismatch");
    assert(projectCandidates.policy === "include_only_C2_PROJECT_WRAPPER", `unexpected policy: ${projectCandidates.policy}`);
    assert(classified.total === summaryNoCandidate.length, "classified total should align with summary.ruleFeedback.noCandidateCallsites");

    const invalid = projectCandidates.items.filter(item => item.category !== "C2_PROJECT_WRAPPER");
    assert(invalid.length === 0, "project candidate pool should only contain C2_PROJECT_WRAPPER");

    console.log("====== No Candidate Project Candidate Pool Test ======");
    console.log(`classified_total=${classified.total}`);
    console.log(`project_candidate_total=${projectCandidates.total}`);
    console.log(`summary_no_candidate_total=${summaryNoCandidate.length}`);
}

try {
    main();
} catch (err) {
    console.error(err);
    process.exitCode = 1;
}
