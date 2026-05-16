import { readAnalyzeSummary, runAnalyzeCli } from "../helpers/AnalyzeCliRunner";
import { resolveTestRunDir, resolveTestRunPath } from "../helpers/TestWorkspaceLayout";
import * as fs from "fs";
import * as path from "path";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

interface AnalyzeSummary {
    summary: { totalFlows: number; withSeeds: number };
    entries: Array<{
        entryName: string;
        status: string;
        postsolveResults?: Array<{
            flow: { sinkFactId?: string; sinkText: string };
            evidenceSummary: { evidenceKinds: string[]; primaryReason?: string };
            judgement: { kind: string };
            paths: Array<{ judgement: { kind: string }; evidence: Array<{ kind: string }> }>;
        }>;
    }>;
}

function writeText(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf-8");
}

async function main(): Promise<void> {
    const root = resolveTestRunDir("analyze", "kernel_sanitizer_catalog");
    const caseRoot = resolveTestRunPath("analyze", "kernel_sanitizer_catalog", "crypto_signature_result");
    const repoRoot = path.join(caseRoot, "repo");
    const outputDir = path.join(caseRoot, "out");
    const sourceDir = path.join(repoRoot, "src", "main", "ets");
    const rulePath = path.join(caseRoot, "kernel_sanitizer_catalog.rules.json");

    fs.rmSync(root, { recursive: true, force: true });

    writeText(
        path.join(sourceDir, "EntryAbility.ets"),
        [
            "import { UIAbility } from '@kit.AbilityKit';",
            "",
            "class Sign {",
            "  signSync(v: string): string { return v; }",
            "}",
            "",
            "function Out(_v: string): void {}",
            "",
            "export default class EntryAbility extends UIAbility {",
            "  onCreate(taint_src: string): void {",
            "    const signer = new Sign();",
            "    const clean = signer.signSync(taint_src);",
            "    Out(clean);",
            "    Out(taint_src);",
            "  }",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        rulePath,
        JSON.stringify({
            schemaVersion: "2.0",
            sources: [{
                id: "source.fixture.kernel_sanitizer_catalog",
                sourceKind: "entry_param",
                match: { kind: "local_name_regex", value: "^taint_src$" },
                target: "arg0",
            }],
            sinks: [{
                id: "sink.fixture.kernel_sanitizer_catalog",
                match: { kind: "method_name_equals", value: "Out" },
                target: "arg0",
            }],
            sanitizers: [],
            transfers: [{
                id: "transfer.fixture.kernel_sanitizer_catalog.sign_sync_arg0_to_result",
                match: { kind: "method_name_equals", value: "signSync" },
                from: "arg0",
                to: "result",
            }],
        }, null, 2),
    );

    runAnalyzeCli([
        "--repo", repoRoot,
        "--sourceDir", ".",
        "--project", rulePath,
        "--reportMode", "full",
        "--no-incremental",
        "--k", "1",
        "--outputDir", outputDir,
    ]);

    const report = readAnalyzeSummary<AnalyzeSummary>(outputDir);
    const entry = report.entries.find(item => item.entryName === "@arkMain") || report.entries[0];
    assert(report.summary.withSeeds > 0, "expected withSeeds > 0");
    assert(entry?.status === "ok", `expected ok entry, got ${entry?.status}`);

    const results = entry.postsolveResults || [];
    const sanitized = results.find(item => item.evidenceSummary.evidenceKinds.includes("sanitizer_rule"));
    assert(sanitized, `expected kernel sanitizer evidence, got ${JSON.stringify(results.map(item => item.evidenceSummary))}`);
    assert(
        sanitized!.paths.some(pathResult =>
            pathResult.judgement.kind === "Refuted-Strong"
            && pathResult.evidence.some(evidence => evidence.kind === "sanitizer_rule")
        ),
        `expected at least one kernel-sanitized witness path, got ${JSON.stringify(sanitized!.paths)}`,
    );
    assert(
        results.some(item => item.judgement.kind !== "Refuted-Strong"),
        "expected raw unsanitized flow to survive",
    );

    console.log("PASS test_analyze_kernel_sanitizer_catalog");
    console.log(`surviving_total_flows=${report.summary.totalFlows}`);
    console.log(`postsolve_results=${results.length}`);
}

main().catch(error => {
    console.error("FAIL test_analyze_kernel_sanitizer_catalog");
    console.error(error);
    process.exit(1);
});
