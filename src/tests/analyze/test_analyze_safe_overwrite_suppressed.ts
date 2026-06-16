import { readAnalyzeSummary, runAnalyzeCli } from "../helpers/AnalyzeCliRunner";
import { stringifyRuleAssetFixture } from "../helpers/RuleAssetFixtureFactory";
import { resolveTestRunDir, resolveTestRunPath } from "../helpers/TestWorkspaceLayout";
import * as fs from "fs";
import * as path from "path";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

interface AnalyzeSummary {
    reportMode: "light" | "full";
    summary: {
        withSeeds: number;
        totalFlows: number;
    };
    entries: Array<{
        entryName: string;
        status: string;
        seedCount: number;
        flowCount: number;
        materializedTaintFlows?: Array<unknown>;
        postsolveResults?: Array<{
            flow: {
                source: string;
                sinkText: string;
                sinkFactId?: string;
            };
            paths: Array<{
                factIds: string[];
                truncated?: boolean;
                evidence: Array<{
                    kind: string;
                }>;
                judgement: {
                    kind: string;
                };
            }>;
            evidenceSummary: {
                evidenceKinds: string[];
                primaryReason?: string;
            };
            judgement: {
                kind: string;
            };
        }>;
    }>;
}

function writeText(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf-8");
}

async function main(): Promise<void> {
    const root = resolveTestRunDir("analyze", "safe_overwrite_suppressed");
    const caseRoot = resolveTestRunPath("analyze", "safe_overwrite_suppressed", "preferences_overwrite_safe");
    const repoRoot = path.join(caseRoot, "repo");
    const moduleRoot = path.join(caseRoot, "module_root");
    const moduleProjectDir = path.join(moduleRoot, "project", "safe_overwrite_suppressed", "modules");
    const outputDir = path.join(caseRoot, "out");
    const sourceDir = path.join(repoRoot, "src", "main", "ets");
    const rulePath = path.join(caseRoot, "safe_overwrite.rules.json");

    fs.rmSync(root, { recursive: true, force: true });

    writeText(
        path.join(sourceDir, "EntryAbility.ets"),
        [
            "import { UIAbility } from '@kit.AbilityKit';",
            "",
            "class StorageBox {",
            "  putSync(_key: string, _value: string): void {}",
            "  getSync(_key: string): string { return \"\"; }",
            "}",
            "",
            "function Sink(v: string): void {}",
            "",
            "export default class EntryAbility extends UIAbility {",
            "  onCreate(taint_src: string): void {",
            "    const p = new StorageBox();",
            "    p.putSync(\"token\", taint_src);",
            "    p.putSync(\"token\", \"safe\");",
            "    Sink(p.getSync(\"token\"));",
            "  }",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        rulePath,
        stringifyRuleAssetFixture({
            id: "asset.rule.fixture.safe_overwrite",
            sources: [
                {
                    id: "source.fixture.safe_overwrite",
                    sourceKind: "entry_param",
                    match: { kind: "method_name_equals", value: "onCreate" },
                    target: "arg0",
                },
            ],
            sinks: [
                {
                    id: "sink.fixture.safe_overwrite",
                    match: {
                        kind: "method_name_equals",
                        value: "Sink",
                    },
                    target: "arg0",
                },
            ],
            sanitizers: [],
            transfers: [],
        }),
    );
    writeText(
        path.join(moduleProjectDir, "storage_box.asset.json"),
        JSON.stringify(storageBoxHandoffAsset("safe_overwrite_suppressed"), null, 2),
    );

    runAnalyzeCli([
        "--repo", repoRoot,
        "--sourceDir", ".",
        "--project", rulePath,
        "--model-root", moduleRoot,
        "--enable-model", "safe_overwrite_suppressed:modules",
        "--kernelRule", "tests/rules/minimal.rules.json",
        "--reportMode", "full",
        "--no-incremental",
        "--k", "1",
        "--outputDir", outputDir,
    ]);

    const report = readAnalyzeSummary<AnalyzeSummary>(outputDir);
    const entry = report.entries.find(item => item.entryName === "@arkMain") || report.entries[0];

    assert(report.reportMode === "full", `expected reportMode=full, got ${report.reportMode}`);
    assert(report.summary.withSeeds > 0, `expected withSeeds > 0, got ${report.summary.withSeeds}`);
    assert(!!entry, "expected one entry result");
    assert(entry.status === "ok", `expected entry status ok, got ${entry.status}`);
    assert(entry.seedCount > 0, `expected seedCount > 0, got ${entry.seedCount}`);
    assert(report.summary.totalFlows === 0, `expected OCLFS currentness to suppress stale storage flow before postsolve, got ${report.summary.totalFlows}`);
    const postsolveResults = entry.postsolveResults || [];
    assert(postsolveResults.length === 0, `expected no postsolve flow after OCLFS suppression, got ${postsolveResults.length}`);

    console.log("PASS test_analyze_safe_overwrite_suppressed");
    console.log(`root=${root}`);
    console.log(`surviving_total_flows=${report.summary.totalFlows}`);
    console.log("currentness_reason=strong_clean_overwrite");
}

function storageBoxHandoffAsset(projectId: string): unknown {
    return {
        id: `asset.module.${projectId}.storage_box`,
        plane: "module",
        status: "reviewed",
        surfaces: [
            invokeSurface("surface.storage_box.putSync", "putSync", 2),
            invokeSurface("surface.storage_box.getSync", "getSync", 1),
        ],
        bindings: [
            handoffBinding(`asset.module.${projectId}.storage_box`, `binding.${projectId}.putSync`, "surface.storage_box.putSync", ["template.putSync"]),
            handoffBinding(`asset.module.${projectId}.storage_box`, `binding.${projectId}.getSync`, "surface.storage_box.getSync", ["template.getSync"]),
        ],
        effectTemplates: [
            {
                id: "template.putSync",
                kind: "handoff.put",
                handle: firstArgHandle(),
                value: { base: { kind: "arg", index: 1 } },
            },
            {
                id: "template.getSync",
                kind: "handoff.get",
                handle: firstArgHandle(),
                target: { base: { kind: "return" } },
            },
        ],
        provenance: {
            source: "llm",
            projectId,
            createdAt: "2026-05-27T00:00:00.000Z",
            evidenceLocations: [{ file: "EntryAbility.ets", line: 3 }],
        },
    };
}

function invokeSurface(surfaceId: string, methodName: string, argCount: number): unknown {
    return {
        surfaceId,
        kind: "invoke",
        modulePath: "project/storage_box",
        ownerName: "StorageBox",
        methodName,
        invokeKind: "instance",
        argCount,
        confidence: "certain",
        provenance: {
            source: "analyzer",
            location: { file: "EntryAbility.ets", line: 3 },
        },
    };
}

function handoffBinding(assetId: string, bindingId: string, surfaceId: string, effectTemplateRefs: string[]): unknown {
    return {
        bindingId,
        assetId,
        surfaceId,
        plane: "module",
        role: "handoff",
        effectTemplateRefs,
        semanticsFamily: "project-keyed-storage",
        completeness: "partial",
        confidence: "certain",
    };
}

function firstArgHandle(): unknown {
    return {
        cellKind: "keyed-semantic-slot",
        family: "project.storage_box",
        key: [{ kind: "fromLiteralArg", index: 0 }],
        precision: "infer",
    };
}

main().catch(error => {
    console.error("FAIL test_analyze_safe_overwrite_suppressed");
    console.error(error);
    process.exit(1);
});
