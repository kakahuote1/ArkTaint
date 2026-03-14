import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { readAnalyzeSummary, runAnalyzeCli } from "./helpers/AnalyzeCliRunner";

interface AnalyzeSummary {
    summary: {
        withSeeds: number;
        withFlows: number;
        totalFlows: number;
        statusCount: Record<string, number>;
        ruleHits: Record<string, Record<string, number>>;
        ruleHitEndpoints: Record<string, Record<string, number>>;
        transferNoHitReasons: Record<string, number>;
    };
    entries: Array<{
        sourceDir: string;
        entryName: string;
        entryPathHint?: string;
        status: string;
        seedCount: number;
        flowCount: number;
        sinkSamples: string[];
        flowRuleTraces: Array<{
            source: string;
            sink: string;
            sourceRuleId?: string;
            sinkRuleId?: string;
            sinkEndpoint?: string;
            transferRuleIds: string[];
        }>;
        ruleHits: Record<string, Record<string, number>>;
        ruleHitEndpoints: Record<string, Record<string, number>>;
        transferNoHitReasons: string[];
        transferProfile: {
            factCount: number;
            invokeSiteCount: number;
            ruleCheckCount: number;
            ruleMatchCount: number;
            endpointCheckCount: number;
            endpointMatchCount: number;
            dedupSkipCount: number;
            resultCount: number;
        };
    }>;
}

function stableStringify(value: any): string {
    if (value === null || value === undefined) return JSON.stringify(value);
    if (typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(v => stableStringify(v)).join(",")}]`;
    const keys = Object.keys(value).sort();
    const fields = keys.map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`);
    return `{${fields.join(",")}}`;
}

function hashText(text: string): string {
    return crypto.createHash("sha256").update(text).digest("hex");
}

function runAnalyze(outputDir: string, concurrency: number): AnalyzeSummary {
    const args = [
        "--repo", "tests/demo/rule_transfer_variants",
        "--sourceDir", ".",
        "--default", "tests/rules/minimal.rules.json",
        "--project", "tests/rules/transfer_variants.rules.json",
        "--k", "1",
        "--maxEntries", "6",
        "--no-incremental",
        "--concurrency", String(concurrency),
        "--outputDir", outputDir,
    ];
    runAnalyzeCli(args);
    return readAnalyzeSummary<AnalyzeSummary>(outputDir);
}

function normalizeReport(report: AnalyzeSummary): any {
    const normalizeRecord = (obj: Record<string, any> | undefined): Record<string, any> => {
        const out: Record<string, any> = {};
        if (!obj) return out;
        const keys = Object.keys(obj).sort();
        for (const k of keys) out[k] = obj[k];
        return out;
    };

    const entries = [...(report.entries || [])].map(e => ({
        sourceDir: e.sourceDir,
        entryName: e.entryName,
        entryPathHint: e.entryPathHint || "",
        status: e.status,
        seedCount: e.seedCount,
        flowCount: e.flowCount,
        sinkSamples: [...(e.sinkSamples || [])].sort(),
        flowRuleTraces: [...(e.flowRuleTraces || [])]
            .map(t => ({
                source: t.source,
                sink: t.sink,
                sourceRuleId: t.sourceRuleId || "",
                sinkRuleId: t.sinkRuleId || "",
                sinkEndpoint: t.sinkEndpoint || "",
                transferRuleIds: [...(t.transferRuleIds || [])],
            }))
            .sort((a, b) => stableStringify(a).localeCompare(stableStringify(b))),
        ruleHits: normalizeRecord(e.ruleHits),
        ruleHitEndpoints: normalizeRecord(e.ruleHitEndpoints),
        transferNoHitReasons: [...(e.transferNoHitReasons || [])].sort(),
        transferProfile: {
            factCount: e.transferProfile?.factCount || 0,
            invokeSiteCount: e.transferProfile?.invokeSiteCount || 0,
            ruleCheckCount: e.transferProfile?.ruleCheckCount || 0,
            ruleMatchCount: e.transferProfile?.ruleMatchCount || 0,
            endpointCheckCount: e.transferProfile?.endpointCheckCount || 0,
            endpointMatchCount: e.transferProfile?.endpointMatchCount || 0,
            dedupSkipCount: e.transferProfile?.dedupSkipCount || 0,
            resultCount: e.transferProfile?.resultCount || 0,
        },
    }));

    entries.sort((a, b) => {
        const ka = `${a.sourceDir}|${a.entryPathHint}|${a.entryName}`;
        const kb = `${b.sourceDir}|${b.entryPathHint}|${b.entryName}`;
        return ka.localeCompare(kb);
    });

    return {
        summary: {
            withSeeds: report.summary?.withSeeds || 0,
            withFlows: report.summary?.withFlows || 0,
            totalFlows: report.summary?.totalFlows || 0,
            statusCount: normalizeRecord(report.summary?.statusCount),
            ruleHits: normalizeRecord(report.summary?.ruleHits),
            ruleHitEndpoints: normalizeRecord(report.summary?.ruleHitEndpoints),
            transferNoHitReasons: normalizeRecord(report.summary?.transferNoHitReasons),
        },
        entries,
    };
}

async function main(): Promise<void> {
    const root = path.resolve("tmp/phase56/analyze_parallel_deterministic");
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });

    const c1 = runAnalyze(path.join(root, "c1"), 1);
    const c4Round1 = runAnalyze(path.join(root, "c4_round1"), 4);
    const c4Round2 = runAnalyze(path.join(root, "c4_round2"), 4);

    const digestC1 = hashText(stableStringify(normalizeReport(c1)));
    const digestC4Round1 = hashText(stableStringify(normalizeReport(c4Round1)));
    const digestC4Round2 = hashText(stableStringify(normalizeReport(c4Round2)));

    console.log("====== Analyze Parallel Determinism Test ======");
    console.log(`digest_c1=${digestC1}`);
    console.log(`digest_c4_round1=${digestC4Round1}`);
    console.log(`digest_c4_round2=${digestC4Round2}`);
    console.log(`flows_c1=${c1.summary.totalFlows}`);
    console.log(`flows_c4_round1=${c4Round1.summary.totalFlows}`);
    console.log(`flows_c4_round2=${c4Round2.summary.totalFlows}`);

    if (digestC1 !== digestC4Round1) {
        throw new Error("semantic digest mismatch: concurrency=1 vs concurrency=4");
    }
    if (digestC4Round1 !== digestC4Round2) {
        throw new Error("semantic digest mismatch: concurrency=4 runs not deterministic");
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
