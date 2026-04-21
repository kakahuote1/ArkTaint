import * as fs from "fs";
import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { buildArkMainPlan } from "../../core/entry/arkmain/ArkMainPlanner";
import {
    collectQualifiedDecoratorCandidates,
    collectSdkOverrideCandidates,
    isSdkBackedArkClass,
} from "../../core/entry/arkmain/facts/ArkMainSdkDeclarationDiscovery";
import { registerMockSdkFiles } from "../helpers/TestSceneBuilder";

function buildScene(projectDir: string): Scene {
    const config = new SceneConfig();
    const harmonySdkDir = path.resolve("arkanalyzer/tests/resources/Sdk");
    if (fs.existsSync(harmonySdkDir) && hasSdkLikeImports(projectDir)) {
        config.getSdksObj().push({
            moduleName: "",
            name: "harmony-sdk",
            path: harmonySdkDir,
        });
    }
    config.buildFromProjectDir(projectDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    registerMockSdkFiles(scene);
    return scene;
}

function hasSdkLikeImports(projectDir: string): boolean {
    for (const entry of fs.readdirSync(projectDir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        if (!/\.(ets|ts)$/.test(entry.name)) continue;
        const text = fs.readFileSync(path.join(projectDir, entry.name), "utf8");
        if (/@ohos|@kit/.test(text)) {
            return true;
        }
    }
    return false;
}

function assert(condition: unknown, message: string): void {
    if (!condition) {
        throw new Error(message);
    }
}

function findFact(plan: ReturnType<typeof buildArkMainPlan>, kind: string, className: string, methodName: string) {
    return plan.facts.find(f =>
        f.kind === kind
        && f.method.getName() === methodName
        && f.method.getDeclaringArkClass?.().getName?.() === className,
    );
}

async function main(): Promise<void> {
    const projectDir = path.resolve("tests/demo/sdk_override_decorator_probe");
    const scene = buildScene(projectDir);
    const outputDir = path.resolve("tmp/test_runs/entry_model/override_decorator_probe/latest");
    fs.mkdirSync(outputDir, { recursive: true });

    const overrideCandidates = collectSdkOverrideCandidates(scene);
    const overrideKeys = new Set(
        overrideCandidates.map(candidate => `${candidate.method.getDeclaringArkClass().getName()}::${candidate.method.getName()}`),
    );
    assert(!overrideKeys.has("LocalDerivedLifecycle::onCreate"), "LocalDerivedLifecycle.onCreate should not be treated as SDK override candidate");

    const abilityClass = scene.getClasses().find(cls => cls.getName() === "SdkOverrideProbeAbility");
    assert(abilityClass, "Missing SdkOverrideProbeAbility class.");
    const sdkSuperClass = abilityClass!.getSuperClass();
    const abilityMethods = abilityClass!.getMethods().filter(method => !method.isStatic());
    const explicitOverrideMethods = abilityMethods
        .filter(method => method.containsModifier?.(require("../../../arkanalyzer/out/src/core/model/ArkBaseModel").ModifierType.OVERRIDE))
        .map(method => method.getName())
        .sort((left, right) => left.localeCompare(right));
    assert(explicitOverrideMethods.includes("onCreate"), "SdkOverrideProbeAbility.onCreate should retain override modifier.");
    assert(explicitOverrideMethods.includes("onNewWant"), "SdkOverrideProbeAbility.onNewWant should retain override modifier.");
    const overrideReady = overrideKeys.has("SdkOverrideProbeAbility::onCreate") && overrideKeys.has("SdkOverrideProbeAbility::onNewWant");

    const decoratorCandidates = collectQualifiedDecoratorCandidates(scene.getClasses());
    const decoratorKeys = new Set(
        decoratorCandidates.map(candidate => `${candidate.ownerClass.getName()}::${candidate.targetKind}::${candidate.targetName}`),
    );
    assert(decoratorKeys.has("SdkDecoratorProbePage::class::SdkDecoratorProbePage"), "Missing qualified class decorator candidate.");
    assert(decoratorKeys.has("SdkDecoratorProbePage::field::value"), "Missing qualified field decorator candidate.");
    assert(decoratorKeys.has("SdkDecoratorProbePage::method::onValueWatch"), "Missing qualified method decorator candidate.");
    assert(
        ![...decoratorKeys].some(key => key.startsWith("PlainDecoratorCarrier::")),
        "PlainDecoratorCarrier should not produce qualified decorator candidates.",
    );

    const plan = buildArkMainPlan(scene);
    const onCreateFact = findFact(plan, "ability_lifecycle", "SdkOverrideProbeAbility", "onCreate");
    assert(onCreateFact, "ArkMain plan missing ability_lifecycle fact for SdkOverrideProbeAbility.onCreate");
    assert(onCreateFact!.entryShape === "override_slot", `Expected override_slot, got ${onCreateFact!.entryShape}`);
    assert(
        onCreateFact!.recognitionLayer === "sdk_override_first_layer" || onCreateFact!.recognitionLayer === "owner_qualified_inheritance",
        `Expected sdk_override_first_layer or owner_qualified_inheritance, got ${onCreateFact!.recognitionLayer}`,
    );
    const onNewWantFact = findFact(plan, "ability_lifecycle", "SdkOverrideProbeAbility", "onNewWant");
    assert(onNewWantFact, "ArkMain plan missing ability_lifecycle fact for SdkOverrideProbeAbility.onNewWant");
    assert(
        onNewWantFact!.recognitionLayer === "sdk_override_first_layer" || onNewWantFact!.recognitionLayer === "owner_qualified_inheritance",
        `Expected sdk_override_first_layer or owner_qualified_inheritance, got ${onNewWantFact!.recognitionLayer}`,
    );

    const pageBuildFact = findFact(plan, "page_build", "SdkDecoratorProbePage", "build");
    assert(pageBuildFact, "ArkMain plan missing page_build fact for SdkDecoratorProbePage.build");
    assert(pageBuildFact!.recognitionLayer === "qualified_decorator_first_layer", `Expected qualified_decorator_first_layer, got ${pageBuildFact!.recognitionLayer}`);
    assert(pageBuildFact!.entryShape === "declaration_owner_slot", `Expected declaration_owner_slot, got ${pageBuildFact!.entryShape}`);
    const plainWatchFact = findFact(plan, "page_build", "PlainDecoratorCarrier", "build");
    assert(!plainWatchFact, "PlainDecoratorCarrier should not produce ArkMain page_build facts without a qualified owner.");

    const stateFact = findFact(plan, "state_trigger", "SdkDecoratorProbePage", "build");
    assert(!stateFact, "state_trigger should no longer remain in ArkMain planner facts");
    assert(
        [...decoratorKeys].includes("SdkDecoratorProbePage::field::value"),
        "Qualified decorator candidates should still keep @State field evidence for SdkDecoratorProbePage.value",
    );

    const report = {
        generatedAt: new Date().toISOString(),
        overrideProbe: {
            superClassName: abilityClass!.getSuperClassName(),
            superClassResolved: Boolean(sdkSuperClass),
            sdkSuperResolved: sdkSuperClass ? isSdkBackedArkClass(scene, sdkSuperClass) : false,
            explicitOverrideMethods,
            resolvedOverrideCandidates: [...overrideKeys].filter(key => key.startsWith("SdkOverrideProbeAbility::")).sort(),
            status: overrideReady ? "resolved" : "owner_qualified_only",
        },
        decoratorProbe: {
            qualifiedCandidates: [...decoratorKeys].sort(),
            pageRecognitionLayer: pageBuildFact!.recognitionLayer,
            stateRecognitionLayer: "outside_arkmain",
        },
    };
    const reportPath = path.join(outputDir, "override_decorator_probe_report.json");
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`Override/decorator probe report written to ${reportPath}`);

    console.log("PASS test_entry_model_override_decorator_probe");
}

main().catch(error => {
    console.error("FAIL test_entry_model_override_decorator_probe");
    console.error(error);
    process.exit(1);
});

