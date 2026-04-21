import * as fs from "fs";
import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { buildArkMainPlan } from "../../core/entry/arkmain/ArkMainPlanner";
import { collectFrameworkManagedOwners } from "../../core/entry/arkmain/facts/ArkMainOwnerDiscovery";
import { registerMockSdkFiles } from "../helpers/TestSceneBuilder";

function assert(condition: unknown, message: string): void {
    if (!condition) {
        throw new Error(message);
    }
}

function buildScene(projectDir: string): Scene {
    const config = new SceneConfig();
    config.buildFromProjectDir(projectDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    registerMockSdkFiles(scene);
    return scene;
}

function writeFixtureProject(projectDir: string): void {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, "taint_mock_ability.ts"), [
        "export class UIAbility {",
        "  onCreate(): void {}",
        "}",
        "",
    ].join("\n"), "utf8");
    fs.writeFileSync(path.join(projectDir, "managed_same_name.ets"), [
        "import { UIAbility } from './taint_mock_ability';",
        "export class EntryAbility extends UIAbility {",
        "  onCreate(): void {}",
        "}",
        "",
    ].join("\n"), "utf8");
    fs.writeFileSync(path.join(projectDir, "plain_same_name.ets"), [
        "export class EntryAbility {",
        "  onCreate(): void {}",
        "}",
        "",
    ].join("\n"), "utf8");
}

function classFilePath(cls: any): string {
    return cls?.getSignature?.()?.getDeclaringFileSignature?.()?.toString?.() || "";
}

function findClassByFile(scene: Scene, className: string, fileName: string): any {
    const matched = scene.getClasses().find(cls =>
        cls.getName?.() === className
        && classFilePath(cls).includes(fileName),
    );
    assert(matched, `missing class ${className} in ${fileName}`);
    return matched;
}

async function main(): Promise<void> {
    const projectDir = path.resolve("tmp/test_runs/entry_model/owner_identity_fixture/latest/project");
    writeFixtureProject(projectDir);

    const scene = buildScene(projectDir);
    const owners = collectFrameworkManagedOwners(scene);
    const managedAbility = findClassByFile(scene, "EntryAbility", "managed_same_name.ets");
    const plainAbility = findClassByFile(scene, "EntryAbility", "plain_same_name.ets");

    assert(owners.isAbilityOwner(managedAbility), "managed EntryAbility should keep ability owner recognition");
    assert(!owners.isFrameworkManagedOwner(plainAbility), "plain EntryAbility must not inherit owner evidence from a same-named class");

    const plan = buildArkMainPlan(scene);
    const managedLifecycleFact = plan.facts.find(fact =>
        fact.kind === "ability_lifecycle"
        && fact.method.getDeclaringArkClass?.()?.getName?.() === "EntryAbility"
        && fact.method.getSignature?.()?.toString?.().includes("managed_same_name.ets")
        && fact.method.getName?.() === "onCreate",
    );
    const plainLifecycleFact = plan.facts.find(fact =>
        fact.kind === "ability_lifecycle"
        && fact.method.getDeclaringArkClass?.()?.getName?.() === "EntryAbility"
        && fact.method.getSignature?.()?.toString?.().includes("plain_same_name.ets")
        && fact.method.getName?.() === "onCreate",
    );

    assert(!!managedLifecycleFact, "managed EntryAbility should produce ability lifecycle fact");
    assert(!plainLifecycleFact, "plain same-named EntryAbility must not produce ability lifecycle fact");

    console.log("PASS test_entry_model_owner_identity");
}

main().catch(error => {
    console.error("FAIL test_entry_model_owner_identity");
    console.error(error);
    process.exit(1);
});
