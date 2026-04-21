import * as fs from "fs";
import * as path from "path";

export interface TestOutputMetadata {
    suite: string;
    domain: string;
    title: string;
    purpose: string;
}

export interface TestOutputLayout {
    rootDir: string;
    runJsonPath: string;
    summaryJsonPath: string;
    reportJsonPath: string;
    reportMarkdownPath: string;
    progressJsonPath: string;
    progressMarkdownPath: string;
}

export type TestSummaryStatus = "pass" | "fail";

export interface TestFailureSummary {
    name: string;
    expected?: string | number | boolean | null;
    actual?: string | number | boolean | null;
    reason: string;
    severity?: "high" | "medium" | "low";
    nextHint?: string;
}

export interface TestSummaryData {
    status: TestSummaryStatus;
    verdict: string;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    totals: Record<string, unknown>;
    highlights?: string[];
    failures?: TestFailureSummary[];
    notes?: string[];
}

export interface TestProgressSnapshot {
    status: "running" | "done";
    startedAt: string;
    updatedAt: string;
    currentStep: number;
    totalSteps: number;
    currentLabel: string;
    detail?: string;
    elapsedMs: number;
    etaMs: number | null;
    percent: number;
    progressBar: string;
}

export interface TestProgressReporterOptions {
    logEveryCount?: number;
    logEveryPercent?: number;
    barWidth?: number;
}

export interface TestProgressReporter {
    update(currentStep: number, currentLabel: string, detail?: string): void;
    finish(currentLabel?: string, detail?: string): void;
}

export type FormalTestSummaryInput = Omit<TestSummaryData, "startedAt" | "finishedAt" | "durationMs">;

export interface TestReportAliasPaths {
    jsonPath?: string;
    markdownPath?: string;
}

export interface WriteFormalTestReportOptions {
    aliases?: TestReportAliasPaths[];
}

export interface FormalTestSuiteController {
    metadata: TestOutputMetadata;
    layout: TestOutputLayout;
    startedAt: string;
    startedAtMs: number;
    createProgress(totalSteps: number, options?: TestProgressReporterOptions): TestProgressReporter;
    writeReport(reportJson: unknown, reportMarkdown: string, options?: WriteFormalTestReportOptions): void;
    finish(summary: FormalTestSummaryInput, options?: { setExitCodeOnFailure?: boolean }): TestSummaryData;
}

function toRelative(rootDir: string, targetPath: string): string {
    return path.relative(rootDir, targetPath).replace(/\\/g, "/");
}

function ensureParentDir(filePath: string): void {
    fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
}

function writeJsonArtifact(filePath: string, payload: unknown): void {
    ensureParentDir(filePath);
    fs.writeFileSync(path.resolve(filePath), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function writeMarkdownArtifact(filePath: string, markdown: string): void {
    ensureParentDir(filePath);
    fs.writeFileSync(path.resolve(filePath), `${markdown}\n`, "utf8");
}

function clampProgressValue(currentStep: number, totalSteps: number): number {
    if (totalSteps <= 0) return 0;
    return Math.max(0, Math.min(currentStep, totalSteps));
}

export function resolveTestOutputLayout(outputDir: string): TestOutputLayout {
    const rootDir = path.resolve(outputDir);
    return {
        rootDir,
        runJsonPath: path.resolve(rootDir, "run.json"),
        summaryJsonPath: path.resolve(rootDir, "summary.json"),
        reportJsonPath: path.resolve(rootDir, "report.json"),
        reportMarkdownPath: path.resolve(rootDir, "report.md"),
        progressJsonPath: path.resolve(rootDir, "progress.json"),
        progressMarkdownPath: path.resolve(rootDir, "progress.md"),
    };
}

export function ensureTestOutputLayout(layout: TestOutputLayout): void {
    fs.mkdirSync(layout.rootDir, { recursive: true });
}

export function formatDurationMs(ms: number | null): string {
    if (ms === null || !Number.isFinite(ms)) return "N/A";
    const totalSeconds = Math.max(0, Math.round(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}h${minutes}m${seconds}s`;
    if (minutes > 0) return `${minutes}m${seconds}s`;
    return `${seconds}s`;
}

export function renderProgressBar(currentStep: number, totalSteps: number, width = 24): string {
    const safeWidth = Math.max(8, width);
    const percent = totalSteps <= 0 ? 0 : clampProgressValue(currentStep, totalSteps) / totalSteps;
    const filled = Math.round(percent * safeWidth);
    return `${"#".repeat(filled)}${"-".repeat(Math.max(0, safeWidth - filled))}`;
}

function renderProgressMarkdown(metadata: TestOutputMetadata, snapshot: TestProgressSnapshot): string {
    return [
        `# ${metadata.title} Progress`,
        "",
        `- suite: ${metadata.suite}`,
        `- domain: ${metadata.domain}`,
        `- purpose: ${metadata.purpose}`,
        `- status: ${snapshot.status}`,
        `- current: ${snapshot.currentStep}/${snapshot.totalSteps}`,
        `- percent: ${snapshot.percent.toFixed(1)}%`,
        `- bar: [${snapshot.progressBar}]`,
        `- label: ${snapshot.currentLabel}`,
        `- detail: ${snapshot.detail || "N/A"}`,
        `- elapsed: ${formatDurationMs(snapshot.elapsedMs)}`,
        `- eta: ${formatDurationMs(snapshot.etaMs)}`,
        `- startedAt: ${snapshot.startedAt}`,
        `- updatedAt: ${snapshot.updatedAt}`,
        "",
    ].join("\n");
}

export function writeTestProgress(
    layout: TestOutputLayout,
    metadata: TestOutputMetadata,
    snapshot: TestProgressSnapshot,
): void {
    ensureTestOutputLayout(layout);
    fs.writeFileSync(layout.progressJsonPath, `${JSON.stringify({
        schemaVersion: "1.0",
        kind: "test_progress",
        suite: metadata.suite,
        domain: metadata.domain,
        title: metadata.title,
        purpose: metadata.purpose,
        ...snapshot,
    }, null, 2)}\n`, "utf8");
    fs.writeFileSync(layout.progressMarkdownPath, `${renderProgressMarkdown(metadata, snapshot)}\n`, "utf8");
}

export function writeTestSummary(
    layout: TestOutputLayout,
    metadata: TestOutputMetadata,
    summary: TestSummaryData,
): void {
    ensureTestOutputLayout(layout);
    const payload = {
        schemaVersion: "1.0",
        kind: "test_summary",
        suite: metadata.suite,
        domain: metadata.domain,
        title: metadata.title,
        purpose: metadata.purpose,
        status: summary.status,
        verdict: summary.verdict,
        startedAt: summary.startedAt,
        finishedAt: summary.finishedAt,
        durationMs: summary.durationMs,
        totals: summary.totals,
        highlights: summary.highlights || [],
        failures: summary.failures || [],
        notes: summary.notes || [],
        artifacts: {
            reportJson: toRelative(layout.rootDir, layout.reportJsonPath),
            reportMd: toRelative(layout.rootDir, layout.reportMarkdownPath),
            progressJson: toRelative(layout.rootDir, layout.progressJsonPath),
            progressMd: toRelative(layout.rootDir, layout.progressMarkdownPath),
        },
    };
    fs.writeFileSync(layout.summaryJsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    fs.writeFileSync(layout.runJsonPath, `${JSON.stringify({
        schemaVersion: "1.0",
        runKind: "test",
        suite: metadata.suite,
        domain: metadata.domain,
        title: metadata.title,
        status: summary.status,
        verdict: summary.verdict,
        generatedAt: summary.finishedAt,
        paths: payload.artifacts,
        summaryJson: toRelative(layout.rootDir, layout.summaryJsonPath),
    }, null, 2)}\n`, "utf8");
}

export function createFormalTestSuite(
    outputDir: string,
    metadata: TestOutputMetadata,
): FormalTestSuiteController {
    const layout = resolveTestOutputLayout(outputDir);
    ensureTestOutputLayout(layout);
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();

    return {
        metadata,
        layout,
        startedAt,
        startedAtMs,
        createProgress(totalSteps: number, options: TestProgressReporterOptions = {}): TestProgressReporter {
            return createTestProgressReporter(layout, metadata, totalSteps, options);
        },
        writeReport(reportJson: unknown, reportMarkdown: string, options: WriteFormalTestReportOptions = {}): void {
            writeJsonArtifact(layout.reportJsonPath, reportJson);
            writeMarkdownArtifact(layout.reportMarkdownPath, reportMarkdown);
            for (const alias of options.aliases || []) {
                if (alias.jsonPath) {
                    writeJsonArtifact(alias.jsonPath, reportJson);
                }
                if (alias.markdownPath) {
                    writeMarkdownArtifact(alias.markdownPath, reportMarkdown);
                }
            }
        },
        finish(
            summary: FormalTestSummaryInput,
            options: { setExitCodeOnFailure?: boolean } = {},
        ): TestSummaryData {
            const finishedAt = new Date().toISOString();
            const durationMs = Date.now() - startedAtMs;
            const completeSummary: TestSummaryData = {
                ...summary,
                startedAt,
                finishedAt,
                durationMs,
            };
            writeTestSummary(layout, metadata, completeSummary);
            printTestConsoleSummary(metadata, layout, completeSummary);
            if ((options.setExitCodeOnFailure ?? true) && completeSummary.status === "fail") {
                process.exitCode = 1;
            }
            return completeSummary;
        },
    };
}

export function formatTestProgressLine(
    metadata: TestOutputMetadata,
    snapshot: TestProgressSnapshot,
): string {
    return `[${snapshot.progressBar}] ${snapshot.currentStep}/${snapshot.totalSteps} ${snapshot.percent.toFixed(1)}% suite=${metadata.suite} elapsed=${formatDurationMs(snapshot.elapsedMs)} eta=${formatDurationMs(snapshot.etaMs)} current=${snapshot.currentLabel}${snapshot.detail ? ` detail=${snapshot.detail}` : ""}`;
}

export function printTestConsoleSummary(
    metadata: TestOutputMetadata,
    layout: TestOutputLayout,
    summary: TestSummaryData,
): void {
    console.log(`====== ${metadata.title} ======`);
    console.log(`suite=${metadata.suite}`);
    console.log(`domain=${metadata.domain}`);
    console.log(`status=${summary.status.toUpperCase()}`);
    console.log(`purpose=${metadata.purpose}`);
    console.log(`verdict=${summary.verdict}`);
    console.log(`duration=${formatDurationMs(summary.durationMs)}`);
    for (const [key, value] of Object.entries(summary.totals || {})) {
        console.log(`${key}=${String(value)}`);
    }
    if ((summary.highlights || []).length > 0) {
        console.log("highlights:");
        for (const item of summary.highlights || []) {
            console.log(`- ${item}`);
        }
    }
    if ((summary.failures || []).length > 0) {
        console.log("failures:");
        for (const item of summary.failures || []) {
            console.log(`- ${item.name}: ${item.reason}`);
        }
    }
    console.log(`summary_json=${layout.summaryJsonPath}`);
    console.log(`report_json=${layout.reportJsonPath}`);
    console.log(`report_md=${layout.reportMarkdownPath}`);
    console.log(`progress_json=${layout.progressJsonPath}`);
    console.log(`progress_md=${layout.progressMarkdownPath}`);
}

export function createTestProgressReporter(
    layout: TestOutputLayout,
    metadata: TestOutputMetadata,
    totalSteps: number,
    options: TestProgressReporterOptions = {},
): TestProgressReporter {
    ensureTestOutputLayout(layout);
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    const logEveryCount = Math.max(1, options.logEveryCount ?? 1);
    const logEveryPercent = Math.max(1, options.logEveryPercent ?? 5);
    const barWidth = options.barWidth ?? 24;
    let lastLoggedStep = 0;
    let lastLoggedPercentBucket = -1;

    const emit = (currentStep: number, currentLabel: string, detail: string | undefined, status: "running" | "done"): void => {
        const safeCurrent = clampProgressValue(currentStep, totalSteps);
        const elapsedMs = Date.now() - startedMs;
        const etaMs = safeCurrent > 0 && totalSteps > 0
            ? Math.round((elapsedMs / safeCurrent) * (totalSteps - safeCurrent))
            : null;
        const percent = totalSteps > 0 ? (safeCurrent / totalSteps) * 100 : 0;
        const snapshot: TestProgressSnapshot = {
            status,
            startedAt,
            updatedAt: new Date().toISOString(),
            currentStep: safeCurrent,
            totalSteps,
            currentLabel,
            detail,
            elapsedMs,
            etaMs,
            percent,
            progressBar: renderProgressBar(safeCurrent, totalSteps, barWidth),
        };
        writeTestProgress(layout, metadata, snapshot);

        const percentBucket = Math.floor(percent / logEveryPercent);
        const shouldLog = status === "done"
            || (safeCurrent === 1 && lastLoggedStep === 0)
            || safeCurrent >= totalSteps
            || safeCurrent - lastLoggedStep >= logEveryCount
            || percentBucket > lastLoggedPercentBucket;
        if (shouldLog) {
            console.log(formatTestProgressLine(metadata, snapshot));
            lastLoggedStep = safeCurrent;
            lastLoggedPercentBucket = percentBucket;
        }
    };

    return {
        update(currentStep: number, currentLabel: string, detail?: string): void {
            emit(currentStep, currentLabel, detail, "running");
        },
        finish(currentLabel = "DONE", detail?: string): void {
            emit(totalSteps, currentLabel, detail, "done");
        },
    };
}
