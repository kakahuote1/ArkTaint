import * as fs from "fs";
import * as path from "path";

type LabelValue = "TP" | "FP" | "Unknown";

type CandidateType = "flow_detected" | "no_seed" | "seed_no_flow" | "exception" | "other";

interface CliOptions {
    reportPath: string;
    outputDir: string;
    sampleSize: number;
    dateTag?: string;
    labelsPath?: string;
    excludeLabelPaths: string[];
}

interface SmokeEntry {
    sourceDir: string;
    entryName: string;
    entryPathHint?: string;
    signature: string;
    score: number;
    status: "ok" | "no_entry" | "no_body" | "no_seed" | "exception";
    seedLocalNames: string[];
    seedStrategies: string[];
    seedCount: number;
    flowCount: number;
    sinkFlowByKeyword: Record<string, number>;
    sinkFlowBySignature: Record<string, number>;
    sinkSamples: string[];
    error?: string;
    elapsedMs: number;
}

interface SmokeProject {
    id: string;
    priority?: "main" | "stress";
    entries: SmokeEntry[];
}

interface SmokeReport {
    generatedAt: string;
    projects: SmokeProject[];
}

interface LabelItem {
    id: string;
    projectId: string;
    projectPriority: "main" | "stress" | "unknown";
    sourceDir: string;
    entryName: string;
    entryPathHint?: string;
    signature: string;
    status: string;
    score: number;
    seedCount: number;
    flowCount: number;
    seedStrategies: string[];
    sinkSamples: string[];
    candidateType: CandidateType;
    priorityScore: number;
    label: LabelValue;
    rootCause: string;
    notes: string;
}

interface SmokeLabelFile {
    generatedAt: string;
    reportGeneratedAt?: string;
    reportPath?: string;
    excludedLabelFiles?: string[];
    excludedItemCount?: number;
    sampleSizeRequested: number;
    sampleSizeActual: number;
    selectionPolicy: string;
    labelSchema: {
        labels: LabelValue[];
        rootCauseHints: string[];
    };
    items: LabelItem[];
}

const ROOT_CAUSE_HINTS = [
    "entry_not_matched",
    "no_seed",
    "sink_not_covered",
    "missing_call_edge",
    "rule_missing",
    "other",
];

function parseArgs(argv: string[]): CliOptions {
    let reportPath = "tmp/phase43/smoke_report.json";
    let outputDir = "tmp/phase43";
    let sampleSize = 20;
    let dateTag: string | undefined;
    let labelsPath: string | undefined;
    const excludeLabelPaths: string[] = [];

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--report" && i + 1 < argv.length) {
            reportPath = argv[++i];
            continue;
        }
        if (arg.startsWith("--report=")) {
            reportPath = arg.slice("--report=".length);
            continue;
        }
        if (arg === "--outputDir" && i + 1 < argv.length) {
            outputDir = argv[++i];
            continue;
        }
        if (arg.startsWith("--outputDir=")) {
            outputDir = arg.slice("--outputDir=".length);
            continue;
        }
        if (arg === "--sampleSize" && i + 1 < argv.length) {
            sampleSize = Number(argv[++i]);
            continue;
        }
        if (arg.startsWith("--sampleSize=")) {
            sampleSize = Number(arg.slice("--sampleSize=".length));
            continue;
        }
        if (arg === "--dateTag" && i + 1 < argv.length) {
            dateTag = argv[++i];
            continue;
        }
        if (arg.startsWith("--dateTag=")) {
            dateTag = arg.slice("--dateTag=".length);
            continue;
        }
        if (arg === "--labels" && i + 1 < argv.length) {
            labelsPath = argv[++i];
            continue;
        }
        if (arg.startsWith("--labels=")) {
            labelsPath = arg.slice("--labels=".length);
            continue;
        }
        if (arg === "--excludeLabels" && i + 1 < argv.length) {
            const raw = argv[++i];
            excludeLabelPaths.push(...raw.split(",").map(x => x.trim()).filter(Boolean));
            continue;
        }
        if (arg.startsWith("--excludeLabels=")) {
            const raw = arg.slice("--excludeLabels=".length);
            excludeLabelPaths.push(...raw.split(",").map(x => x.trim()).filter(Boolean));
            continue;
        }
    }

    if (!Number.isFinite(sampleSize) || sampleSize <= 0) {
        throw new Error(`Invalid --sampleSize value: ${sampleSize}. Expected positive integer.`);
    }

    return {
        reportPath,
        outputDir,
        sampleSize: Math.floor(sampleSize),
        dateTag,
        labelsPath,
        excludeLabelPaths,
    };
}

function ensureDir(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
}

function classifyCandidate(entry: SmokeEntry): CandidateType {
    if (entry.status === "exception") return "exception";
    if (entry.flowCount > 0) return "flow_detected";
    if (entry.status === "no_seed") return "no_seed";
    if (entry.seedCount > 0 && entry.flowCount === 0) return "seed_no_flow";
    return "other";
}

function buildPriority(entry: SmokeEntry, candidateType: CandidateType, projectPriority: string): number {
    let score = 0;
    if (candidateType === "flow_detected") score += 1000;
    if (candidateType === "no_seed") score += 700;
    if (candidateType === "exception") score += 600;
    if (candidateType === "seed_no_flow") score += 350;
    if (candidateType === "other") score += 200;

    score += entry.flowCount * 30;
    score += entry.seedCount * 5;
    score += Math.floor(entry.score / 5);
    if (projectPriority === "main") score += 40;
    if (projectPriority === "stress") score += 10;
    return score;
}

function flattenCandidates(report: SmokeReport): LabelItem[] {
    const items: LabelItem[] = [];
    for (const project of report.projects || []) {
        const priority = project.priority || "unknown";
        for (const entry of project.entries || []) {
            const candidateType = classifyCandidate(entry);
            const priorityScore = buildPriority(entry, candidateType, priority);
            const key = `${project.id}|${entry.signature}|${entry.entryPathHint || ""}|${entry.entryName}`;
            items.push({
                id: key,
                projectId: project.id,
                projectPriority: priority === "main" || priority === "stress" ? priority : "unknown",
                sourceDir: entry.sourceDir,
                entryName: entry.entryName,
                entryPathHint: entry.entryPathHint,
                signature: entry.signature,
                status: entry.status,
                score: entry.score,
                seedCount: entry.seedCount,
                flowCount: entry.flowCount,
                seedStrategies: entry.seedStrategies || [],
                sinkSamples: entry.sinkSamples || [],
                candidateType,
                priorityScore,
                label: "Unknown",
                rootCause: "",
                notes: "",
            });
        }
    }
    return items;
}

function sortCandidates(items: LabelItem[]): LabelItem[] {
    return [...items].sort((a, b) => {
        if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
        if (b.flowCount !== a.flowCount) return b.flowCount - a.flowCount;
        if (b.seedCount !== a.seedCount) return b.seedCount - a.seedCount;
        return a.id.localeCompare(b.id);
    });
}

function takeByType(
    source: LabelItem[],
    selected: LabelItem[],
    used: Set<string>,
    type: CandidateType,
    quota: number,
    maxSize: number
): void {
    if (quota <= 0) return;
    const pool = source.filter(x => x.candidateType === type);
    let taken = 0;
    for (const item of pool) {
        if (selected.length >= maxSize) break;
        if (taken >= quota) break;
        if (used.has(item.id)) continue;
        selected.push(item);
        used.add(item.id);
        taken++;
    }
}

function sampleCandidates(items: LabelItem[], sampleSize: number): LabelItem[] {
    const sorted = sortCandidates(items);
    const selected: LabelItem[] = [];
    const used = new Set<string>();

    const flowCount = sorted.filter(x => x.candidateType === "flow_detected").length;
    const noSeedCount = sorted.filter(x => x.candidateType === "no_seed").length;
    const seedNoFlowCount = sorted.filter(x => x.candidateType === "seed_no_flow").length;
    const exceptionCount = sorted.filter(x => x.candidateType === "exception").length;

    const flowQuota = Math.min(Math.max(4, Math.floor(sampleSize * 0.35)), flowCount);
    const noSeedQuota = Math.min(Math.max(6, Math.floor(sampleSize * 0.35)), noSeedCount);
    const seedNoFlowQuota = Math.min(Math.max(4, Math.floor(sampleSize * 0.2)), seedNoFlowCount);
    const exceptionQuota = Math.min(Math.max(1, Math.floor(sampleSize * 0.1)), exceptionCount);

    takeByType(sorted, selected, used, "flow_detected", flowQuota, sampleSize);
    takeByType(sorted, selected, used, "no_seed", noSeedQuota, sampleSize);
    takeByType(sorted, selected, used, "seed_no_flow", seedNoFlowQuota, sampleSize);
    takeByType(sorted, selected, used, "exception", exceptionQuota, sampleSize);

    const mainProjects = new Set(
        sorted
            .filter(x => x.projectPriority === "main")
            .map(x => x.projectId)
    );
    for (const projectId of mainProjects) {
        if (selected.length >= sampleSize) break;
        if (selected.some(x => x.projectId === projectId)) continue;
        const candidate = sorted.find(x => x.projectId === projectId && !used.has(x.id));
        if (!candidate) continue;
        selected.push(candidate);
        used.add(candidate.id);
    }

    for (const item of sorted) {
        if (selected.length >= sampleSize) break;
        if (used.has(item.id)) continue;
        selected.push(item);
        used.add(item.id);
    }

    return selected;
}

function toDateTag(dateTag?: string): string {
    if (dateTag && dateTag.trim().length > 0) return dateTag.trim();
    return new Date().toISOString().slice(0, 10);
}

function renderSummaryMarkdown(labelFile: SmokeLabelFile, fileName: string): string {
    const lines: string[] = [];
    const items = labelFile.items || [];

    const byLabel: Record<string, number> = {};
    const byType: Record<string, number> = {};
    const byRootCause: Record<string, number> = {};
    const byProject: Record<string, number> = {};

    for (const item of items) {
        byLabel[item.label] = (byLabel[item.label] || 0) + 1;
        byType[item.candidateType] = (byType[item.candidateType] || 0) + 1;
        const rootCause = item.rootCause && item.rootCause.trim().length > 0 ? item.rootCause.trim() : "(unfilled)";
        byRootCause[rootCause] = (byRootCause[rootCause] || 0) + 1;
        byProject[item.projectId] = (byProject[item.projectId] || 0) + 1;
    }

    lines.push("# Phase 4.3.5 Smoke Label Summary");
    lines.push("");
    lines.push(`- generatedAt: ${new Date().toISOString()}`);
    lines.push(`- labelsFile: ${fileName}`);
    lines.push(`- sampleSizeRequested: ${labelFile.sampleSizeRequested}`);
    lines.push(`- sampleSizeActual: ${labelFile.sampleSizeActual}`);
    if (labelFile.reportPath) lines.push(`- sourceReport: ${labelFile.reportPath}`);
    lines.push(`- excludedItemCount: ${labelFile.excludedItemCount || 0}`);
    if ((labelFile.excludedLabelFiles || []).length > 0) {
        lines.push(`- excludedLabelFiles: ${(labelFile.excludedLabelFiles || []).join(", ")}`);
    }
    lines.push("");

    lines.push("## Label Counts");
    lines.push("");
    for (const key of ["TP", "FP", "Unknown"]) {
        lines.push(`- ${key}: ${byLabel[key] || 0}`);
    }
    lines.push("");

    lines.push("## Candidate Type Counts");
    lines.push("");
    for (const key of Object.keys(byType).sort()) {
        lines.push(`- ${key}: ${byType[key]}`);
    }
    lines.push("");

    lines.push("## Root Cause Counts");
    lines.push("");
    for (const key of Object.keys(byRootCause).sort()) {
        lines.push(`- ${key}: ${byRootCause[key]}`);
    }
    lines.push("");

    lines.push("## Project Counts");
    lines.push("");
    for (const key of Object.keys(byProject).sort()) {
        lines.push(`- ${key}: ${byProject[key]}`);
    }
    lines.push("");

    const unresolved = items
        .filter(x => x.label === "Unknown")
        .sort((a, b) => b.priorityScore - a.priorityScore)
        .slice(0, 10);
    lines.push("## Top Unresolved");
    lines.push("");
    for (const item of unresolved) {
        lines.push(`- [${item.projectId}] ${item.entryName} @ ${item.entryPathHint || "N/A"} | type=${item.candidateType} | status=${item.status} | flows=${item.flowCount} | seeds=${item.seedCount} | priority=${item.priorityScore}`);
    }
    lines.push("");

    return lines.join("\n");
}

function loadJson<T>(filePath: string): T {
    const abs = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
    if (!fs.existsSync(abs)) {
        throw new Error(`File not found: ${abs}`);
    }
    const raw = fs.readFileSync(abs, "utf-8").replace(/^\uFEFF/, "");
    return JSON.parse(raw) as T;
}

function collectExcludedIds(labelPaths: string[]): Set<string> {
    const out = new Set<string>();
    for (const p of labelPaths) {
        const parsed = loadJson<SmokeLabelFile>(p);
        for (const item of parsed.items || []) {
            if (item.id) out.add(item.id);
        }
    }
    return out;
}

function buildLabelFile(
    report: SmokeReport,
    reportPath: string,
    sampleSize: number,
    excludeLabelPaths: string[],
    excludedIds: Set<string>
): SmokeLabelFile {
    const candidates = flattenCandidates(report);
    const eligible = candidates.filter(x => !excludedIds.has(x.id));
    const sampled = sampleCandidates(eligible, sampleSize);
    const excludedItemCount = candidates.length - eligible.length;
    const selectionPolicy = excludeLabelPaths.length > 0
        ? "priority+quota(flow/no_seed/seed_no_flow/exception)+main_project_coverage+exclude_previous_labels"
        : "priority+quota(flow/no_seed/seed_no_flow/exception)+main_project_coverage";
    return {
        generatedAt: new Date().toISOString(),
        reportGeneratedAt: report.generatedAt,
        reportPath: path.resolve(reportPath),
        excludedLabelFiles: excludeLabelPaths.map(p => path.isAbsolute(p) ? p : path.resolve(p)),
        excludedItemCount,
        sampleSizeRequested: sampleSize,
        sampleSizeActual: sampled.length,
        selectionPolicy,
        labelSchema: {
            labels: ["TP", "FP", "Unknown"],
            rootCauseHints: ROOT_CAUSE_HINTS,
        },
        items: sampled,
    };
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const dateTag = toDateTag(options.dateTag);

    if (options.labelsPath) {
        const labelFile = loadJson<SmokeLabelFile>(options.labelsPath);
        const labelsAbs = path.isAbsolute(options.labelsPath) ? options.labelsPath : path.resolve(options.labelsPath);
        const summaryPath = path.resolve(
            path.dirname(labelsAbs),
            path.basename(labelsAbs).replace("smoke_labels_", "smoke_label_summary_").replace(/\.json$/i, ".md")
        );
        const summary = renderSummaryMarkdown(labelFile, labelsAbs);
        fs.writeFileSync(summaryPath, summary, "utf-8");
        console.log(`labels_file=${labelsAbs}`);
        console.log(`summary_md=${summaryPath}`);
        return;
    }

    const report = loadJson<SmokeReport>(options.reportPath);
    const excludedIds = collectExcludedIds(options.excludeLabelPaths);
    const labelFile = buildLabelFile(
        report,
        options.reportPath,
        options.sampleSize,
        options.excludeLabelPaths,
        excludedIds
    );

    ensureDir(options.outputDir);
    const labelsPath = path.resolve(options.outputDir, `smoke_labels_${dateTag}.json`);
    const summaryPath = path.resolve(options.outputDir, `smoke_label_summary_${dateTag}.md`);
    fs.writeFileSync(labelsPath, JSON.stringify(labelFile, null, 2), "utf-8");
    fs.writeFileSync(summaryPath, renderSummaryMarkdown(labelFile, labelsPath), "utf-8");

    const unknownCount = labelFile.items.filter(x => x.label === "Unknown").length;
    const flowCandidates = labelFile.items.filter(x => x.candidateType === "flow_detected").length;
    const noSeedCandidates = labelFile.items.filter(x => x.candidateType === "no_seed").length;
    console.log(`sample_size=${labelFile.sampleSizeActual}`);
    console.log(`unknown_labels=${unknownCount}`);
    console.log(`flow_candidates=${flowCandidates}`);
    console.log(`no_seed_candidates=${noSeedCandidates}`);
    console.log(`excluded_by_labels=${labelFile.excludedItemCount || 0}`);
    console.log(`labels_json=${labelsPath}`);
    console.log(`summary_md=${summaryPath}`);
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});


