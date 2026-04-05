import * as fs from "fs";
import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { buildArkMainPlan } from "../../core/entry/arkmain/ArkMainPlanner";
import { collectFrameworkManagedOwners } from "../../core/entry/arkmain/facts/ArkMainOwnerDiscovery";
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

function findClass(scene: Scene, className: string) {
    const cls = scene.getClasses().find(item => item.getName() === className);
    assert(cls, `missing class ${className}`);
    return cls!;
}

async function main(): Promise<void> {
    const projectDir = path.resolve("tests/demo/sdk_override_decorator_probe");
    const scene = buildScene(projectDir);
    const owners = collectFrameworkManagedOwners(scene);

    const abilityOwner = findClass(scene, "SdkOverrideProbeAbility");
    const pageOwner = findClass(scene, "SdkDecoratorProbePage");
    const localDerived = findClass(scene, "LocalDerivedLifecycle");
    const plainCarrier = findClass(scene, "PlainDecoratorCarrier");

    assert(owners.isAbilityOwner(abilityOwner), "SdkOverrideProbeAbility should be recognized as ability owner.");
    assert(owners.isFrameworkManagedOwner(abilityOwner), "SdkOverrideProbeAbility should be framework-managed.");
    assert(
        owners.getPrimaryRecognitionLayer(abilityOwner) === "owner_qualified_inheritance",
        `SdkOverrideProbeAbility recognition layer mismatch: ${owners.getPrimaryRecognitionLayer(abilityOwner)}`,
    );

    assert(owners.isComponentOwner(pageOwner), "SdkDecoratorProbePage should be recognized as component owner.");
    assert(owners.isFrameworkManagedOwner(pageOwner), "SdkDecoratorProbePage should be framework-managed.");
    assert(
        owners.getPrimaryRecognitionLayer(pageOwner) === "qualified_decorator_first_layer",
        `SdkDecoratorProbePage recognition layer mismatch: ${owners.getPrimaryRecognitionLayer(pageOwner)}`,
    );

    assert(!owners.isFrameworkManagedOwner(localDerived), "LocalDerivedLifecycle should not be recognized as framework-managed.");
    assert(owners.isComponentOwner(plainCarrier), "PlainDecoratorCarrier should be recognized as component owner by contract shape.");
    assert(owners.isFrameworkManagedOwner(plainCarrier), "PlainDecoratorCarrier should be recognized as framework-managed.");
    assert(
        owners.getPrimaryRecognitionLayer(plainCarrier) === "component_contract_shape",
        `PlainDecoratorCarrier recognition layer mismatch: ${owners.getPrimaryRecognitionLayer(plainCarrier)}`,
    );

    const plan = buildArkMainPlan(scene);
    const hasAbilityLifecycleOnManagedOwner = plan.facts.some(fact =>
        fact.kind === "ability_lifecycle"
        && fact.method.getDeclaringArkClass?.().getName?.() === "SdkOverrideProbeAbility"
        && fact.method.getName?.() === "onCreate",
    );
    const hasAbilityLifecycleOnPlainOwner = plan.facts.some(fact =>
        fact.kind === "ability_lifecycle"
        && fact.method.getDeclaringArkClass?.().getName?.() === "LocalDerivedLifecycle"
        && fact.method.getName?.() === "onCreate",
    );
    const hasPageBuildOnManagedOwner = plan.facts.some(fact =>
        fact.kind === "page_build"
        && fact.method.getDeclaringArkClass?.().getName?.() === "SdkDecoratorProbePage"
        && fact.method.getName?.() === "build",
    );
    const hasPageBuildOnPlainOwner = plan.facts.some(fact =>
        fact.kind === "page_build"
        && fact.method.getDeclaringArkClass?.().getName?.() === "PlainDecoratorCarrier"
        && fact.method.getName?.() === "build",
    );
    assert(hasAbilityLifecycleOnManagedOwner, "Managed ability owner should produce lifecycle contract fact.");
    assert(!hasAbilityLifecycleOnPlainOwner, "Non-managed plain owner should not produce lifecycle contract fact.");
    assert(hasPageBuildOnManagedOwner, "Managed component owner should produce page build contract fact.");
    assert(hasPageBuildOnPlainOwner, "Plain component contract owner should produce page build contract fact.");

    const reportDir = path.resolve("tmp/test_runs/entry_model/owner_discovery_probe/latest");
    fs.mkdirSync(reportDir, { recursive: true });
    const reportPath = path.join(reportDir, "owner_discovery_report.json");
    fs.writeFileSync(reportPath, JSON.stringify({
        generatedAt: new Date().toISOString(),
        frameworkManagedOwnerCount: owners.records.length,
        owners: owners.records.map(record => ({
            className: record.ownerClass.getName(),
            ownerKinds: record.ownerKinds,
            evidences: record.evidences,
        })),
    }, null, 2), "utf8");

    console.log(`Owner discovery report written to ${reportPath}`);
    console.log("PASS test_entry_model_owner_discovery");
}

main().catch(error => {
    console.error("FAIL test_entry_model_owner_discovery");
    console.error(error);
    process.exit(1);
});

