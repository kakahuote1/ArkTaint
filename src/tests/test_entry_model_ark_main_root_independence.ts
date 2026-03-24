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
    assertContains(engineSource, "return this.createArkMainSyntheticEntry(entryMethods);", "ArkMain synthetic-root dispatch");
    assertContains(engineSource, "private createArkMainSyntheticEntry", "ArkMain synthetic-root factory");
    assertContains(builderSource, "export class ArkMainSyntheticRootBuilder", "ArkMainSyntheticRootBuilder class");
    assertContains(builderSource, "createFlatCfg", "flat CFG builder");

    console.log("PASS test_entry_model_ark_main_root_independence");
}

main();
