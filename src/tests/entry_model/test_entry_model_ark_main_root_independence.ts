import * as fs from "fs";
import * as path from "path";

function assertContains(source: string, expected: string, label: string): void {
    if (!source.includes(expected)) {
        throw new Error(`Missing ${label}: ${expected}`);
    }
}

function main(): void {
    const enginePath = path.resolve("src/core/orchestration/TaintPropagationEngine.ts");
    const builderPath = path.resolve("src/core/entry/arkmain/ArkMainSyntheticRootBuilder.ts");

    const engineSource = fs.readFileSync(enginePath, "utf8");
    const builderSource = fs.readFileSync(builderPath, "utf8");

    assertContains(engineSource, "const entryModel: EntryModel = options.entryModel || \"arkMain\";", "ArkMain default entry model");
    assertContains(engineSource, "private createSyntheticEntry(entryModel: EntryModel, entryMethods: ArkMethod[] = []): {", "shared synthetic-root factory");
    assertContains(engineSource, "const root = SYNTHETIC_ROOTS[entryModel];", "entry-model keyed synthetic-root dispatch");
    assertContains(engineSource, "arkMain: {", "ArkMain synthetic-root descriptor");
    assertContains(engineSource, "explicit: {", "explicit synthetic-root descriptor");
    assertContains(engineSource, "methodName: \"@arkMain\",", "ArkMain synthetic-root name");
    assertContains(engineSource, "methodName: \"@explicitEntry\",", "explicit synthetic-root name");
    assertContains(builderSource, "export class ArkMainSyntheticRootBuilder", "ArkMainSyntheticRootBuilder class");
    assertContains(builderSource, "createFlatCfg", "flat CFG builder");

    console.log("PASS test_entry_model_ark_main_root_independence");
}

main();
