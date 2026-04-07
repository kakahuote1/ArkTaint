import * as fs from "fs";
import * as path from "path";

type Mode = "report" | "clean-stale";

interface CliOptions {
    mode: Mode;
}

interface TmpEntryRecord {
    name: string;
    kind: "directory" | "file";
    category: "managed" | "stale" | "other";
    relativePath: string;
    mtime: string;
}

interface MaintenanceReport {
    generatedAt: string;
    mode: Mode;
    tmpRoot: string;
    managedEntries: TmpEntryRecord[];
    staleEntries: TmpEntryRecord[];
    otherEntries: TmpEntryRecord[];
    removedPaths: string[];
}

const MANAGED_ROOT_NAMES = new Set([
    ".gitkeep",
    "test_runs",
]);

const STALE_ROOT_PATTERNS: RegExp[] = [
    /^phase\d+/i,
    /^harmony_bench/i,
    /^real_project/i,
    /^real_projects$/i,
    /^analyze$/i,
    /^tests$/i,
    /^adhoc/i,
    /^layout_probe$/i,
    /^llm_experiment$/i,
    /^_codex_.*probe$/i,
    /^debug_/i,
    /^verify_/i,
    /^build_/i,
    /^audit_/i,
    /^diagnose_/i,
    /^orig_/i,
    /^repro_/i,
    /^paper_extract_/i,
    /^arktan_eval/i,
    /^constructor_/i,
    /^container_/i,
    /^rule_precision_/i,
    /^sdk_signature_probe$/i,
    /^wanandroid_report$/i,
    /^telegram_entry_compare$/i,
    /^entry_compare$/i,
    /^layer4_realworld_validation$/i,
    /^harmonychat_comparison$/i,
    /^harmony_.*\.log$/i,
    /^.*\.log$/i,
    /^_old_/i,
];

function parseArgs(argv: string[]): CliOptions {
    let mode: Mode = "report";
    for (const arg of argv) {
        if (arg === "--apply" || arg === "--mode=clean-stale") {
            mode = "clean-stale";
        } else if (arg === "--mode=report") {
            mode = "report";
        }
    }
    return { mode };
}

function ensureDir(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
}

function classifyEntry(name: string): "managed" | "stale" | "other" {
    if (MANAGED_ROOT_NAMES.has(name)) {
        return "managed";
    }
    if (STALE_ROOT_PATTERNS.some(pattern => pattern.test(name))) {
        return "stale";
    }
    return "other";
}

function collectRecords(tmpRoot: string): TmpEntryRecord[] {
    if (!fs.existsSync(tmpRoot)) {
        return [];
    }
    return fs.readdirSync(tmpRoot, { withFileTypes: true })
        .map(entry => {
            const abs = path.join(tmpRoot, entry.name);
            const stat = fs.statSync(abs);
            return {
                name: entry.name,
                kind: entry.isDirectory() ? "directory" as const : "file" as const,
                category: classifyEntry(entry.name),
                relativePath: path.relative(process.cwd(), abs).replace(/\\/g, "/"),
                mtime: stat.mtime.toISOString(),
            };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
}

function renderMarkdown(report: MaintenanceReport): string {
    const lines: string[] = [];
    lines.push("# Tmp Workspace Maintenance Report");
    lines.push("");
    lines.push(`- generatedAt: ${report.generatedAt}`);
    lines.push(`- mode: ${report.mode}`);
    lines.push(`- tmpRoot: ${report.tmpRoot}`);
    lines.push(`- managed: ${report.managedEntries.length}`);
    lines.push(`- stale: ${report.staleEntries.length}`);
    lines.push(`- other: ${report.otherEntries.length}`);
    lines.push(`- removed: ${report.removedPaths.length}`);
    lines.push("");
    const sections: Array<[string, TmpEntryRecord[]]> = [
        ["Managed", report.managedEntries],
        ["Stale", report.staleEntries],
        ["Other", report.otherEntries],
    ];
    for (const [title, items] of sections) {
        lines.push(`## ${title}`);
        lines.push("");
        if (items.length === 0) {
            lines.push("- none");
            lines.push("");
            continue;
        }
        for (const item of items) {
            lines.push(`- ${item.kind}: ${item.relativePath} (mtime=${item.mtime})`);
        }
        lines.push("");
    }
    if (report.removedPaths.length > 0) {
        lines.push("## Removed");
        lines.push("");
        for (const removed of report.removedPaths) {
            lines.push(`- ${removed}`);
        }
        lines.push("");
    }
    return lines.join("\n");
}

function main(): void {
    const options = parseArgs(process.argv.slice(2));
    const tmpRoot = path.resolve("tmp");
    ensureDir(tmpRoot);

    const records = collectRecords(tmpRoot);
    const staleEntries = records.filter(item => item.category === "stale");
    const removedPaths: string[] = [];

    if (options.mode === "clean-stale") {
        for (const item of staleEntries) {
            const abs = path.resolve(item.relativePath);
            if (!fs.existsSync(abs)) continue;
            fs.rmSync(abs, { recursive: true, force: true });
            removedPaths.push(item.relativePath);
        }
    }

    const report: MaintenanceReport = {
        generatedAt: new Date().toISOString(),
        mode: options.mode,
        tmpRoot,
        managedEntries: records.filter(item => item.category === "managed"),
        staleEntries,
        otherEntries: records.filter(item => item.category === "other"),
        removedPaths,
    };

    const outDir = path.resolve("tmp", "test_runs", "_maintenance", "latest");
    ensureDir(outDir);
    const jsonPath = path.join(outDir, "stale_tmp_report.json");
    const mdPath = path.join(outDir, "stale_tmp_report.md");
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf-8");
    fs.writeFileSync(mdPath, renderMarkdown(report), "utf-8");

    console.log("====== Tmp Workspace Maintenance ======");
    console.log(`mode=${options.mode}`);
    console.log(`managed=${report.managedEntries.length}`);
    console.log(`stale=${report.staleEntries.length}`);
    console.log(`other=${report.otherEntries.length}`);
    console.log(`removed=${report.removedPaths.length}`);
    console.log(`report_json=${jsonPath}`);
    console.log(`report_md=${mdPath}`);
}

main();
