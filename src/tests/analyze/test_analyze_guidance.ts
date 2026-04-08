import * as fs from "fs";
import { getAnalyzeSummaryMarkdownPath, runAnalyzeCli } from "../helpers/AnalyzeCliRunner";
import { resolveTestRunDir } from "../helpers/TestWorkspaceLayout";

function runAnalyze(outputDir: string): string {
    const args = [
        "--repo", "tests/demo/rule_transfer_variants",
        "--sourceDir", ".",
        "--kernelRule", "tests/rules/minimal.rules.json",
        "--project", "tests/rules/transfer_variants.rules.json",
        "--k", "1",
        "--maxEntries", "6",
        "--no-incremental",
        "--reportMode", "light",
        "--outputDir", outputDir,
    ];
    runAnalyzeCli(args);
    return getAnalyzeSummaryMarkdownPath(outputDir);
}

function section(md: string, title: string): string {
    const start = md.indexOf(title);
    if (start < 0) return "";
    const rest = md.slice(start + title.length);
    const nextHeader = rest.search(/\n### |\n## /);
    return nextHeader >= 0 ? rest.slice(0, nextHeader) : rest;
}

async function main(): Promise<void> {
    const root = resolveTestRunDir("analyze", "guidance");
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });

    const mdPath = runAnalyze(root);
    if (!fs.existsSync(mdPath)) {
        throw new Error(`summary.md not found: ${mdPath}`);
    }
    const md = fs.readFileSync(mdPath, "utf-8");

    const header = "## Next Steps";
    const hitHeader = "### Hit Rules (Top)";
    const missHeader = "### No-Hit Reasons (Top)";
    const gapHeader = "### Suggested Rule Gaps (Top)";

    if (!md.includes(header)) throw new Error(`missing section: ${header}`);
    if (!md.includes(hitHeader)) throw new Error(`missing section: ${hitHeader}`);
    if (!md.includes(missHeader)) throw new Error(`missing section: ${missHeader}`);
    if (!md.includes(gapHeader)) throw new Error(`missing section: ${gapHeader}`);

    const hitText = section(md, hitHeader);
    const missText = section(md, missHeader);
    const gapText = section(md, gapHeader);

    if (!/\n- /.test(hitText)) throw new Error("Hit Rules section has no bullet lines");
    if (!/\n- /.test(missText)) throw new Error("No-Hit Reasons section has no bullet lines");
    if (!/\n- /.test(gapText)) throw new Error("Suggested Rule Gaps section has no bullet lines");

    console.log("====== Analyze Guidance Test ======");
    console.log(`summary_md=${mdPath}`);
    console.log("guidance_section_present=true");
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
