import * as fs from "fs";
import * as path from "path";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { inspectArkMainProjects, loadArkMainSeeds } from "../../core/entry/arkmain/ArkMainLoader";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function buildScene(sourceDir: string): Scene {
    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(sourceDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(sceneConfig);
    scene.inferTypes();
    return scene;
}

function writeJson(target: string, value: unknown): void {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(value, null, 2), "utf8");
}

function makeArkMainAsset(id: string, status: "reviewed" | "schema-valid"): unknown {
    return {
        id,
        plane: "arkmain",
        status,
        surfaces: [
            {
                surfaceId: `${id}.libraryPanel.build.surface`,
                kind: "entry",
                ownerKind: "component",
                ownerName: "LibraryPanel",
                methodName: "build",
                phase: "composition",
                entryKind: "page_build",
                confidence: "likely",
                provenance: {
                    source: status === "schema-valid" ? "llm-proposal" : "analyzer",
                    location: { file: "asset_loader.ets" },
                },
            },
        ],
        bindings: [
            {
                bindingId: `${id}.libraryPanel.build.binding`,
                surfaceId: `${id}.libraryPanel.build.surface`,
                assetId: id,
                plane: "arkmain",
                role: "entry",
                effectTemplateRefs: [`${id}.libraryPanel.build.effect`],
                semanticsFamily: "page_build",
                completeness: "partial",
                confidence: "likely",
            },
        ],
        effectTemplates: [
            {
                id: `${id}.libraryPanel.build.effect`,
                kind: "entry.lifecycle",
                entryKind: "page_build",
                method: "build",
                confidence: "likely",
            },
        ],
        provenance: {
            source: status === "schema-valid" ? "llm" : "manual",
            projectId: "shared_entry",
            reviewedBy: "test-reviewer",
        },
    };
}

function makeArkMainCallbackRegisterAsset(id: string, status: "schema-valid"): unknown {
    return {
        id,
        plane: "arkmain",
        status,
        surfaces: [
            {
                surfaceId: `${id}.hdweb.surface`,
                kind: "invoke",
                modulePath: "entry/src/main/ets/pages/LibraryPanel.ets",
                invokeKind: "free-function",
                functionName: "HdWeb",
                argCount: 1,
                confidence: "likely",
                provenance: {
                    source: "llm-proposal",
                    location: { file: "asset_loader.ets", line: 12 },
                },
            },
        ],
        bindings: [
            {
                bindingId: `${id}.hdweb.onload.binding`,
                surfaceId: `${id}.hdweb.surface`,
                assetId: id,
                plane: "arkmain",
                role: "entry",
                effectTemplateRefs: [`${id}.hdweb.onload.effect`],
                completeness: "partial",
                confidence: "likely",
            },
        ],
        effectTemplates: [
            {
                id: `${id}.hdweb.onload.effect`,
                kind: "entry.callbackRegister",
                callback: {
                    kind: "option",
                    base: { base: { kind: "arg", index: 0 } },
                    accessPath: ["onLoad"],
                },
                confidence: "likely",
            },
        ],
        provenance: {
            source: "llm",
            projectId: "semanticflow",
        },
    };
}

async function main(): Promise<void> {
    const root = path.resolve("tmp/test_runs/runtime/arkmain_asset_loader/latest");
    const sourceDir = path.join(root, "source");
    const sourceFile = path.join(sourceDir, "entry/src/main/ets/pages/LibraryPanel.ets");
    const arkMainRoot = path.join(root, "arkmain_assets");
    const projectAssetDir = path.join(arkMainRoot, "project", "shared_entry", "arkmain");
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.mkdirSync(projectAssetDir, { recursive: true });
    fs.writeFileSync(sourceFile, `
function HdWeb(options: any): void {
  let hdwebMarker = "project-component";
}

@Component
struct LibraryPanel {
  onLoaded(): void {
    let callbackMarker = "callback-loaded";
  }

  build(): void {
    let marker = "project-component-build";
    HdWeb({ onLoad: this.onLoaded });
  }
}
`, "utf8");
    writeJson(
        path.join(projectAssetDir, "semanticflow.arkmain.json"),
        makeArkMainAsset("project.shared_entry.arkmain.semanticflow", "reviewed"),
    );

    const result = inspectArkMainProjects({
        includeBuiltinArkMain: false,
        arkMainRoots: [arkMainRoot],
        enabledArkMainProjects: ["shared_entry"],
    });

    assert(result.discoveredArkMainProjects.includes("shared_entry"), "expected shared_entry to be discovered");
    assert(result.enabledArkMainProjects.includes("shared_entry"), "expected shared_entry to be enabled");
    assert(result.loadedFiles.length === 1, `expected one v2 arkmain asset file, got ${result.loadedFiles.length}`);

    const scene = buildScene(sourceDir);
    const disabledLoad = loadArkMainSeeds(scene, {
        includeBuiltinArkMain: false,
        arkMainRoots: [arkMainRoot],
        enabledArkMainProjects: [],
    });
    assert(disabledLoad.methods.length === 0, "disabled project arkmain assets must not create entry methods");
    assert(disabledLoad.facts.length === 0, "disabled project arkmain assets must not create entry facts");

    const load = loadArkMainSeeds(scene, {
        includeBuiltinArkMain: false,
        arkMainRoots: [arkMainRoot],
        enabledArkMainProjects: ["shared_entry"],
    });
    assert(load.loadedFiles.length === 1, `expected one loaded arkmain asset file, got ${load.loadedFiles.length}`);
    assert(load.methods.some(method =>
        method.getName() === "build"
        && method.getDeclaringArkClass?.()?.getName?.() === "LibraryPanel"
    ), "expected LibraryPanel.build to be loaded as arkmain seed method");
    const fact = load.facts.find(item =>
        item.kind === "page_build"
        && item.phase === "composition"
        && item.method.getName() === "build"
        && item.method.getDeclaringArkClass?.()?.getName?.() === "LibraryPanel"
    );
    assert(fact, "expected LibraryPanel.build page_build fact");
    assert(fact.ownerKind === "component_owner", `expected component owner, actual=${fact.ownerKind}`);
    assert(fact.recognitionLayer === "project_arkmain_asset", `expected project asset recognition layer, actual=${fact.recognitionLayer}`);

    const evaluationRoot = path.join(root, "semanticflow_evaluation_model_root");
    const evaluationProjectDir = path.join(evaluationRoot, "generated_model_assets", "project", "semanticflow", "arkmain");
    writeJson(
        path.join(evaluationProjectDir, "semanticflow.arkmain.json"),
        makeArkMainAsset("project.semanticflow.arkmain.overlay", "schema-valid"),
    );
    writeJson(
        path.join(evaluationProjectDir, "semanticflow.callback.arkmain.json"),
        makeArkMainCallbackRegisterAsset("project.semanticflow.arkmain.callback.overlay", "schema-valid"),
    );

    const trustedSchemaValidLoad = loadArkMainSeeds(scene, {
        includeBuiltinArkMain: false,
        arkMainRoots: [evaluationRoot],
        enabledArkMainProjects: ["semanticflow"],
    });
    assert(trustedSchemaValidLoad.methods.length === 0, "schema-valid arkmain asset must stay inert outside semanticflow evaluation mode");
    assert(trustedSchemaValidLoad.facts.length === 0, "schema-valid arkmain asset must not create entry facts in trusted mode");

    const overlayInspection = inspectArkMainProjects({
        includeBuiltinArkMain: false,
        semanticflowEvaluationModelRoots: [evaluationRoot],
    });
    assert(overlayInspection.discoveredArkMainProjects.includes("semanticflow"), "evaluation arkmain project should be discovered from evaluation root");
    assert(overlayInspection.enabledArkMainProjects.includes("semanticflow"), "evaluation arkmain project should be enabled by overlay root");
    assert(overlayInspection.loadedFiles.length === 2, `expected two evaluation arkmain asset files, got ${overlayInspection.loadedFiles.length}`);

    const overlayLoad = loadArkMainSeeds(scene, {
        includeBuiltinArkMain: false,
        semanticflowEvaluationModelRoots: [evaluationRoot],
    });
    assert(overlayLoad.loadedFiles.length === 2, `expected two loaded evaluation arkmain asset files, got ${overlayLoad.loadedFiles.length}`);
    assert(overlayLoad.methods.some(method =>
        method.getName() === "build"
        && method.getDeclaringArkClass?.()?.getName?.() === "LibraryPanel"
    ), "expected evaluation overlay to load LibraryPanel.build without explicit model enablement");
    const callbackFact = overlayLoad.facts.find(item =>
        item.kind === "callback"
        && item.method.getName() === "onLoaded"
        && item.sourceMethod?.getName?.() === "build"
        && item.callbackSlotFamily === "project_component_option_slot"
    );
    assert(callbackFact, "expected evaluation overlay to lower InvokeSurface entry.callbackRegister into callback fact");
    assert(overlayLoad.methods.some(method =>
        method.getName() === "onLoaded"
        && method.getDeclaringArkClass?.()?.getName?.() === "LibraryPanel"
    ), "expected callbackRegister lowering to seed LibraryPanel.onLoaded");

    const overlayDisabledLoad = loadArkMainSeeds(scene, {
        includeBuiltinArkMain: false,
        semanticflowEvaluationModelRoots: [evaluationRoot],
        disabledArkMainProjects: ["semanticflow"],
    });
    assert(overlayDisabledLoad.methods.length === 0, "disabled evaluation arkmain project must not create entry methods");
    assert(overlayDisabledLoad.facts.length === 0, "disabled evaluation arkmain project must not create entry facts");

    console.log("PASS test_arkmain_asset_loader");
}

main().catch(error => {
    console.error("FAIL test_arkmain_asset_loader");
    console.error(error);
    process.exit(1);
});
