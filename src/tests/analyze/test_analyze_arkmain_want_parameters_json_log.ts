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
    fs.writeFileSync(path.join(projectDir, "entry_ability.ets"), [
        "class UIAbility {}",
        "class Want {",
        "  parameters: Record<string, string> = {};",
        "}",
        "class hilog {",
        "  info(domain: number, tag: string, format: string, value: string): void {}",
        "}",
        "class EntryAbility extends UIAbility {",
        "  onCreate(want: Want): void {",
        "    const raw = want.parameters.params;",
        "    const params = JSON.parse(raw as string);",
        "    const log = new hilog();",
        "    log.info(0, 'tag', '%{public}s', JSON.stringify(params));",
        "  }",
        "}",
        "",
    ].join("\n"), "utf8");
}

interface AnalyzeReport {
    summary: {
        totalFlows: number;
        ruleHits: {
            source: Record<string, number>;
        };
    };
    entries: Array<{
        postsolveResults?: Array<{
            paths: Array<{
                factIds: string[];
            }>;
        }>;
    }>;
}

function main(): void {
    const root = path.resolve("tmp/test_runs/analyze/arkmain_want_parameters_json_log/latest");
    const projectDir = path.join(root, "project");
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });
    writeFixture(projectDir);

    runAnalyzeCli([
        "--repo", projectDir,
        "--sourceDir", ".",
        "--entryModel", "arkMain",
        "--reportMode", "full",
        "--maxEntries", "9999",
        "--worklistBudgetMs", "45000",
        "--no-incremental",
        "--outputDir", root,
    ]);

    const report = readAnalyzeSummary<AnalyzeReport>(root);
    assert(report.summary.totalFlows >= 1, "expected Want.parameters JSON log flow to be reported");
    assert(
        Object.keys(report.summary.ruleHits.source || {}).some(id => id.includes("source.arkmain.contract.lifecycle.want.")),
        "expected field-path Want.parameters source rule to be seeded",
    );
    const postsolvePaths = report.entries.flatMap(entry => entry.postsolveResults || []).flatMap(result => result.paths);
    assert(
        postsolvePaths.some(path => path.factIds.some(factId => factId.endsWith(".parameters"))),
        "expected recovered path to include the field-path Want.parameters fact",
    );

    console.log("PASS test_analyze_arkmain_want_parameters_json_log");
}

try {
    main();
} catch (error) {
    console.error("FAIL test_analyze_arkmain_want_parameters_json_log");
    console.error(error);
    process.exit(1);
}
