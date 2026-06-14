import * as fs from "fs";
import * as path from "path";
import {
    readAnalyzeSummary,
    runAnalyzeCli,
} from "../helpers/AnalyzeCliRunner";
import { resolveTestRunDir, resolveTestRunPath } from "../helpers/TestWorkspaceLayout";

interface ClassifiedItem {
    category: string;
    callee_signature: string;
}

interface ClassifiedPayload {
    total: number;
    items: ClassifiedItem[];
}

interface ApiModelingCandidatePayload {
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

function writeText(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf-8");
}

function createLateCandidateFixture(repoRoot: string): void {
    const sourceRoot = path.join(repoRoot, "entry", "src", "main", "ets");
    for (let i = 0; i < 110; i++) {
        writeText(path.join(sourceRoot, "services", `NoiseService${String(i).padStart(3, "0")}.ets`), `
export class NoiseService${i} {
  request(payload: string): void {
    console.info("noise", payload);
  }
}
`);
    }
    writeText(path.join(sourceRoot, "zz_webdav", "client.ts"), `
export class WebDavClient {
  private password: string = "";
  buildAuthHeaders(): Record<string, string> {
    const credentials = "user:" + this.password;
    return { Authorization: "Basic " + credentials };
  }
  send(headers: Record<string, string>): void {
    const finalHeaders = { ...this.buildAuthHeaders(), ...headers };
    WebDavLogger.getInstance().debug("WebDavClient", "request headers", finalHeaders);
  }
}

export class WebDavLogger {
  static getInstance(): WebDavLogger {
    return new WebDavLogger();
  }
  debug(category: string, message: string, data?: unknown): void {
    console.debug(category + message + JSON.stringify(data));
  }
}
`);
    writeText(path.join(sourceRoot, "Index.ets"), `
import { WebDavClient } from "./zz_webdav/client";

export function main(): void {
  new WebDavClient().send({ Depth: "0" });
}
`);
}

function main(): void {
    const outputDir = resolveTestRunDir("analyze", "no_candidate_api_modeling_candidate_pool");
    const feedbackDir = resolveTestRunPath("analyze", "no_candidate_api_modeling_candidate_pool", "feedback", "rule_feedback");
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
    const classifiedPath = path.resolve(feedbackDir, "no_candidate_callsites_classified.json");
    const apiModelingCandidatePath = path.resolve(feedbackDir, "api_modeling_candidates.json");
    const classified = readJson<ClassifiedPayload>(classifiedPath);
    const apiModelingCandidates = readJson<ApiModelingCandidatePayload>(apiModelingCandidatePath);
    const summaryNoCandidate = summary.summary.ruleFeedback?.noCandidateCallsites || [];

    assert(classified.total === classified.items.length, "classified total/items mismatch");
    assert(apiModelingCandidates.total === apiModelingCandidates.items.length, "API modeling candidate total/items mismatch");
    assert(apiModelingCandidates.policy === "include_neutral_api_modeling_surfaces_and_selected_external_sdk_gaps", `unexpected policy: ${apiModelingCandidates.policy}`);
    assert(classified.total === summaryNoCandidate.length, "classified total should align with summary.ruleFeedback.noCandidateCallsites");

    const invalid = apiModelingCandidates.items.filter(item => !["C2_API_MODELING_CANDIDATE", "C3_FRAMEWORK_GAP"].includes(item.category));
    assert(invalid.length === 0, "API modeling candidate pool should only contain neutral API modeling candidates or selected external SDK gaps");

    console.log("====== No Candidate API Modeling Candidate Pool Test ======");
    console.log(`classified_total=${classified.total}`);
    console.log(`api_modeling_candidate_total=${apiModelingCandidates.total}`);
    console.log(`summary_no_candidate_total=${summaryNoCandidate.length}`);
}

function runLateCandidatePoolRegression(): void {
    const repoRoot = resolveTestRunDir("analyze", "no_candidate_api_modeling_candidate_pool_late_fixture_repo");
    const outputDir = resolveTestRunDir("analyze", "no_candidate_api_modeling_candidate_pool_late_fixture");
    const feedbackDir = resolveTestRunPath("analyze", "no_candidate_api_modeling_candidate_pool_late_fixture", "feedback", "rule_feedback");
    fs.rmSync(repoRoot, { recursive: true, force: true });
    fs.rmSync(outputDir, { recursive: true, force: true });
    createLateCandidateFixture(repoRoot);

    runAnalyzeCli([
        "--repo", repoRoot,
        "--sourceDir", "entry/src/main/ets",
        "--profile", "default",
        "--maxEntries", "1",
        "--no-incremental",
        "--outputDir", outputDir,
    ]);

    const apiModelingCandidatePath = path.resolve(feedbackDir, "api_modeling_candidates.json");
    const apiModelingCandidates = readJson<ApiModelingCandidatePayload>(apiModelingCandidatePath);
    const serialized = JSON.stringify(apiModelingCandidates.items);

    assert(
        apiModelingCandidates.total > 100,
        `API modeling candidate pool should not be pre-capped before SemanticFlow queueing, got ${apiModelingCandidates.total}`,
    );
    assert(
        /WebDavClient|WebDavLogger|Authorization|finalHeaders/.test(serialized),
        "late WebDAV-like project wrapper/logger candidates should survive candidate-pool generation",
    );
}

try {
    main();
    runLateCandidatePoolRegression();
} catch (err) {
    console.error(err);
    process.exitCode = 1;
}


