import { readAnalyzeSummary, runAnalyzeCli } from "../helpers/AnalyzeCliRunner";
import { stringifyRuleAssetFixture } from "../helpers/RuleAssetFixtureFactory";
import { resolveTestRunDir, resolveTestRunPath } from "../helpers/TestWorkspaceLayout";
import * as fs from "fs";
import * as path from "path";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

interface AnalyzeSummary {
    reportMode: "light" | "full";
    summary: { totalFlows: number; withSeeds: number };
    entries: Array<{
        entryName: string;
        status: string;
        postsolveResults?: Array<{
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
    const root = resolveTestRunDir("analyze", "delete_before_read_refinement");
    const caseRoot = resolveTestRunPath("analyze", "delete_before_read_refinement", "preferences_delete_then_read");
    const repoRoot = path.join(caseRoot, "repo");
    const moduleRoot = path.join(caseRoot, "module_root");
    const moduleProjectDir = path.join(moduleRoot, "project", "delete_before_read_refinement", "modules");
    const outputDir = path.join(caseRoot, "out");
    const sourceDir = path.join(repoRoot, "src", "main", "ets");
    const rulePath = path.join(caseRoot, "delete_before_read.rules.json");

    fs.rmSync(root, { recursive: true, force: true });

    writeText(
        path.join(sourceDir, "EntryAbility.ets"),
        [
            "import { UIAbility } from '@kit.AbilityKit';",
            "",
            "class KeyStorage {",
            "  setItem(_key: string, _value: string): void {}",
            "  deleteItem(_key: string): void {}",
            "  getItem(_key: string): string { return \"\"; }",
            "}",
            "",
            "function Sink(_v: string): void {}",
            "",
            "export default class EntryAbility extends UIAbility {",
            "  onCreate(taint_src: string): void {",
            "    const p = new KeyStorage();",
            "    p.setItem(\"token\", taint_src);",
            "    p.deleteItem(\"token\");",
            "    Sink(p.getItem(\"token\"));",
            "    p.deleteItem(\"live\");",
            "    p.setItem(\"live\", taint_src);",
            "    Sink(p.getItem(\"live\"));",
            "  }",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        rulePath,
        stringifyRuleAssetFixture({
            id: "asset.rule.fixture.delete_before_read",
            sources: [{
                id: "source.fixture.delete_before_read",
                sourceKind: "entry_param",
                match: { kind: "method_name_equals", value: "onCreate" },
                target: "arg0",
            }],
            sinks: [{
                id: "sink.fixture.delete_before_read",
                match: { kind: "method_name_equals", value: "Sink" },
                target: "arg0",
            }],
            sanitizers: [],
            transfers: [],
        }),
    );
    writeText(
        path.join(moduleProjectDir, "key_storage.asset.json"),
        JSON.stringify(keyStorageHandoffAsset("delete_before_read_refinement"), null, 2),
    );

    runAnalyzeCli([
        "--repo", repoRoot,
        "--sourceDir", ".",
        "--project", rulePath,
        "--model-root", moduleRoot,
        "--enable-model", "delete_before_read_refinement:modules",
        "--kernelRule", "tests/rules/minimal.rules.json",
        "--reportMode", "full",
        "--no-incremental",
        "--k", "1",
        "--outputDir", outputDir,
    ]);

    const report = readAnalyzeSummary<AnalyzeSummary>(outputDir);
    const entry = report.entries.find(item => item.entryName === "@arkMain") || report.entries[0];
    assert(report.reportMode === "full", `expected reportMode=full, got ${report.reportMode}`);
    assert(report.summary.withSeeds > 0, "expected withSeeds > 0");
    assert(entry?.status === "ok", `expected ok entry, got ${entry?.status}`);
    assert(report.summary.totalFlows === 1, `expected OCLFS to keep only the put-after-delete flow, got ${report.summary.totalFlows}`);

    const results = entry.postsolveResults || [];
    assert(!results.some(item => item.evidenceSummary.evidenceKinds.includes("delete_before_read")), "delete_before_read must not remain as an independent postsolve evidence");
    assert(results.some(item => item.judgement.kind !== "Refuted-Strong"), "expected put-after-delete flow to survive");

    console.log("PASS test_analyze_delete_before_read_refinement");
    console.log(`surviving_total_flows=${report.summary.totalFlows}`);
    console.log(`postsolve_results=${results.length}`);
}

function keyStorageHandoffAsset(projectId: string): unknown {
    return {
        id: `asset.module.${projectId}.key_storage`,
        plane: "module",
        status: "reviewed",
        surfaces: [
            invokeSurface("surface.key_storage.setItem", "setItem", 2),
            invokeSurface("surface.key_storage.getItem", "getItem", 1),
            invokeSurface("surface.key_storage.deleteItem", "deleteItem", 1),
        ],
        bindings: [
            handoffBinding(`asset.module.${projectId}.key_storage`, `binding.${projectId}.setItem`, "surface.key_storage.setItem", ["template.setItem"]),
            handoffBinding(`asset.module.${projectId}.key_storage`, `binding.${projectId}.getItem`, "surface.key_storage.getItem", ["template.getItem"]),
            handoffBinding(`asset.module.${projectId}.key_storage`, `binding.${projectId}.deleteItem`, "surface.key_storage.deleteItem", ["template.deleteItem"]),
        ],
        effectTemplates: [
            {
                id: "template.setItem",
                kind: "handoff.put",
                handle: firstArgHandle(),
                value: { base: { kind: "arg", index: 1 } },
            },
            {
                id: "template.getItem",
                kind: "handoff.get",
                handle: firstArgHandle(),
                target: { base: { kind: "return" } },
            },
            {
                id: "template.deleteItem",
                kind: "handoff.kill",
                handle: firstArgHandle(),
            },
        ],
        provenance: {
            source: "manual",
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
        modulePath: "project/key_storage",
        ownerName: "KeyStorage",
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
        family: "project.key_storage",
        key: [{ kind: "fromLiteralArg", index: 0 }],
        precision: "infer",
    };
}

main().catch(error => {
    console.error("FAIL test_analyze_delete_before_read_refinement");
    console.error(error);
    process.exit(1);
});
