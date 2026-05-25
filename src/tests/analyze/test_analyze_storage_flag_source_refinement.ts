import * as fs from "fs";
import * as path from "path";
import { runAnalyzeCli, readAnalyzeSummary } from "../helpers/AnalyzeCliRunner";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function writeFixture(projectDir: string): void {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, "storage_flag.ets"), [
        "class UIAbility {",
        "  onCreate(want: string): void {}",
        "}",
        "",
        "class Preferences {",
        "  get(key: string, defaultValue: boolean): boolean {",
        "    return defaultValue;",
        "  }",
        "}",
        "",
        "class CommonConstants {",
        "  static readonly PREFERENCES_KEY_PRIVACY: string = 'isPrivacy';",
        "}",
        "",
        "class hilog {",
        "  info(domain: number, tag: string, format: string, value: boolean): void {}",
        "}",
        "",
        "class DemoAbility extends UIAbility {",
        "  onCreate(want: string): void {",
        "    const prefs = new Preferences();",
        "    const accepted = prefs.get(CommonConstants.PREFERENCES_KEY_PRIVACY, true);",
        "    const log = new hilog();",
        "    log.info(0, 'tag', '%{public}s', accepted);",
        "  }",
        "}",
        "",
    ].join("\n"), "utf8");
}

interface AnalyzeReport {
    summary: {
        totalFlows: number;
    };
    entries: Array<{
        postsolveResults?: Array<{
            judgement: { kind: string; primaryReason?: string; evidenceKinds: string[] };
            paths: Array<{
                judgement: { kind: string; primaryReason?: string; evidenceKinds: string[] };
                evidence: Array<{ kind: string; meta: Record<string, unknown> }>;
            }>;
        }>;
    }>;
}

function main(): void {
    const root = path.resolve("tmp/test_runs/analyze/storage_flag_source_refinement/latest");
    const projectDir = path.join(root, "project");
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });
    writeFixture(projectDir);

    runAnalyzeCli([
        "--repo", projectDir,
        "--sourceDir", ".",
        "--reportMode", "full",
        "--maxEntries", "9999",
        "--worklistBudgetMs", "45000",
        "--no-incremental",
        "--outputDir", root,
    ]);

    const report = readAnalyzeSummary<AnalyzeReport>(root);
    assert(report.summary.totalFlows === 0, `expected boolean storage flag source to be suppressed, got ${report.summary.totalFlows}`);
    const result = report.entries.flatMap(entry => entry.postsolveResults || [])[0];
    assert(result, "expected postsolve result for suppressed flow");
    assert(result.judgement.kind === "Refuted-Strong", `expected Refuted-Strong judgement, got ${result.judgement.kind}`);
    assert(result.judgement.evidenceKinds.includes("storage_flag_source"), `expected storage_flag_source evidence, got ${result.judgement.evidenceKinds.join(",")}`);
    assert(result.paths.some(path => path.evidence.some(item => item.kind === "storage_flag_source")), "missing path-level storage_flag_source evidence");

    console.log("PASS test_analyze_storage_flag_source_refinement");
}

try {
    main();
} catch (error) {
    console.error("FAIL test_analyze_storage_flag_source_refinement");
    console.error(error);
    process.exit(1);
}
