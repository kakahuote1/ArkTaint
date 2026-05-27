import * as fs from "fs";
import * as path from "path";
import { inspectArkMainProjects } from "../../core/entry/arkmain/ArkMainLoader";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

async function main(): Promise<void> {
    const root = path.resolve("tmp/test_runs/runtime/arkmain_asset_loader/latest");
    const arkMainRoot = path.join(root, "arkmain_assets");
    const projectAssetDir = path.join(arkMainRoot, "project", "shared_entry", "arkmain");
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(projectAssetDir, { recursive: true });
    fs.writeFileSync(path.join(projectAssetDir, "semanticflow.arkmain.json"), JSON.stringify({
        id: "project.shared_entry.arkmain.semanticflow",
        plane: "arkmain",
        status: "reviewed",
        surfaces: [
            {
                surfaceId: "shared_entry.onCreate.surface",
                kind: "entry",
                ownerKind: "ability",
                ownerName: "DemoAbility",
                methodName: "onCreate",
                phase: "bootstrap",
                entryKind: "ability_lifecycle",
                confidence: "likely",
                provenance: { source: "analyzer", location: { file: "asset_loader.ets" } },
            },
        ],
        bindings: [
            {
                bindingId: "shared_entry.onCreate.binding",
                surfaceId: "shared_entry.onCreate.surface",
                assetId: "project.shared_entry.arkmain.semanticflow",
                plane: "arkmain",
                role: "entry",
                effectTemplateRefs: ["shared_entry.onCreate.effect"],
                semanticsFamily: "ability_lifecycle",
                completeness: "partial",
                confidence: "likely",
            },
        ],
        effectTemplates: [
            {
                id: "shared_entry.onCreate.effect",
                kind: "entry.lifecycle",
                entryKind: "ability_lifecycle",
                method: "onCreate",
                confidence: "likely",
            },
        ],
        provenance: { source: "manual", projectId: "shared_entry", reviewedBy: "test-reviewer" },
    }, null, 2), "utf8");

    const result = inspectArkMainProjects({
        includeBuiltinArkMain: false,
        arkMainRoots: [arkMainRoot],
        enabledArkMainProjects: ["shared_entry"],
    });

    assert(result.discoveredArkMainProjects.includes("shared_entry"), "expected shared_entry to be discovered");
    assert(result.enabledArkMainProjects.includes("shared_entry"), "expected shared_entry to be enabled");
    assert(result.loadedFiles.length === 1, `expected one v2 arkmain asset file, got ${result.loadedFiles.length}`);

    console.log("PASS test_arkmain_asset_loader");
}

main().catch(error => {
    console.error("FAIL test_arkmain_asset_loader");
    console.error(error);
    process.exit(1);
});
