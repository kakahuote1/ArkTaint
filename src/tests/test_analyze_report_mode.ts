import * as fs from "fs";
import * as path from "path";
import { readAnalyzeSummary, runAnalyzeCli } from "./helpers/AnalyzeCliRunner";

interface AnalyzeReport {
    reportMode: "light" | "full";
    entries: Array<{
        sinkSamples: string[];
        flowRuleTraces: any[];
        ruleHits: {
            source: Record<string, number>;
            sink: Record<string, number>;
            transfer: Record<string, number>;
        };
        transferNoHitReasons: string[];
    }>;
}

function runAnalyze(outputDir: string, reportMode: "light" | "full"): AnalyzeReport {
    const args = [
        "--repo", "tests/demo/rule_transfer_variants",
        "--sourceDir", ".",
        "--default", "tests/rules/minimal.rules.json",
        "--project", "tests/rules/transfer_variants.rules.json",
        "--k", "1",
        "--maxEntries", "6",
        "--no-incremental",
        "--reportMode", reportMode,
        "--outputDir", outputDir,
    ];
    runAnalyzeCli(args);
    return readAnalyzeSummary<AnalyzeReport>(outputDir);
}

function hitCount(rec: Record<string, number>): number {
    let n = 0;
    for (const v of Object.values(rec || {})) n += v;
    return n;
}

async function main(): Promise<void> {
    const root = path.resolve("tmp/phase56/analyze_report_mode");
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });

    const light = runAnalyze(path.join(root, "light"), "light");
    const full = runAnalyze(path.join(root, "full"), "full");

    if (light.reportMode !== "light") {
        throw new Error(`expected light.reportMode=light, got ${light.reportMode}`);
    }
    if (full.reportMode !== "full") {
        throw new Error(`expected full.reportMode=full, got ${full.reportMode}`);
    }

    let lightHeavyLeak = 0;
    for (const e of light.entries || []) {
        const heavy = (e.sinkSamples?.length || 0)
            + (e.flowRuleTraces?.length || 0)
            + hitCount(e.ruleHits?.source || {})
            + hitCount(e.ruleHits?.sink || {})
            + hitCount(e.ruleHits?.transfer || {})
            + (e.transferNoHitReasons?.length || 0);
        if (heavy > 0) lightHeavyLeak++;
    }

    let fullHeavyPresent = 0;
    for (const e of full.entries || []) {
        const heavy = (e.sinkSamples?.length || 0)
            + (e.flowRuleTraces?.length || 0)
            + hitCount(e.ruleHits?.source || {})
            + hitCount(e.ruleHits?.sink || {})
            + hitCount(e.ruleHits?.transfer || {})
            + (e.transferNoHitReasons?.length || 0);
        if (heavy > 0) fullHeavyPresent++;
    }

    console.log("====== Analyze Report Mode Test ======");
    console.log(`light_entries=${(light.entries || []).length}`);
    console.log(`full_entries=${(full.entries || []).length}`);
    console.log(`light_heavy_leak=${lightHeavyLeak}`);
    console.log(`full_heavy_present=${fullHeavyPresent}`);

    if (lightHeavyLeak > 0) {
        throw new Error(`expected no heavy details in light mode, leak=${lightHeavyLeak}`);
    }
    if (fullHeavyPresent <= 0) {
        throw new Error("expected heavy details in full mode, got none");
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
