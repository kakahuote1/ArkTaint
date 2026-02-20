import * as fs from "fs";
import * as path from "path";
import { getAnalyzeSummaryMarkdownPath, runAnalyzeCli } from "./helpers/AnalyzeCliRunner";

function runAnalyze(outputDir: string): string {
    const args = [
        "--repo", "tests/demo/rule_transfer_variants",
        "--sourceDir", ".",
        "--default", "tests/rules/minimal.rules.json",
        "--project", "tests/rules/transfer_variants.rules.json",
        "--k", "1",
        "--maxEntries", "6",
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
    const root = path.resolve("tmp/phase57/analyze_guidance");
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });

    const mdPath = runAnalyze(root);
    if (!fs.existsSync(mdPath)) {
        throw new Error(`summary.md not found: ${mdPath}`);
    }
    const md = fs.readFileSync(mdPath, "utf-8");

    const header = "## 下一步建议";
    const hitHeader = "### 命中规则（Top）";
    const missHeader = "### 未命中原因（Top）";
    const gapHeader = "### 建议补规则位点（Top）";

    if (!md.includes(header)) throw new Error(`missing section: ${header}`);
    if (!md.includes(hitHeader)) throw new Error(`missing section: ${hitHeader}`);
    if (!md.includes(missHeader)) throw new Error(`missing section: ${missHeader}`);
    if (!md.includes(gapHeader)) throw new Error(`missing section: ${gapHeader}`);

    const hitText = section(md, hitHeader);
    const missText = section(md, missHeader);
    const gapText = section(md, gapHeader);

    if (!/\n- /.test(hitText)) throw new Error("命中规则 section has no bullet lines");
    if (!/\n- /.test(missText)) throw new Error("未命中原因 section has no bullet lines");
    if (!/\n- /.test(gapText)) throw new Error("建议补规则位点 section has no bullet lines");

    console.log("====== Analyze Guidance Test ======");
    console.log(`summary_md=${mdPath}`);
    console.log("guidance_section_present=true");
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
