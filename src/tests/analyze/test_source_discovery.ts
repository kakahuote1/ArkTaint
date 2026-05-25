import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { discoverArkTsSourceDirs, normalizeSourceDirsForCli } from "../../cli/sourceDiscovery";
import { resolveTestRunDir } from "../helpers/TestWorkspaceLayout";

function writeFile(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf-8");
}

function main(): void {
    const root = resolveTestRunDir("analyze", "source_discovery");
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });

    writeFile(path.join(root, "entry", "src", "main", "ets", "EntryAbility.ets"), "export class EntryAbility {}\n");
    writeFile(path.join(root, "feature", "src", "main", "ets", "Feature.ets"), "export class Feature {}\n");
    writeFile(path.join(root, "node_modules", "bad", "src", "main", "ets", "Ignored.ets"), "export class Ignored {}\n");
    writeFile(path.join(root, "tmp", "bad", "src", "main", "ets", "Ignored.ets"), "export class IgnoredTmp {}\n");

    const discovered = discoverArkTsSourceDirs(root);
    assert.deepStrictEqual(discovered, [
        "entry/src/main/ets",
        "feature/src/main/ets",
    ]);

    const multiModuleRoot = path.join(root, "multi_module");
    writeFile(path.join(multiModuleRoot, "build-profile.json5"), `{
      modules: [
        { name: "entry", srcPath: "./entry" },
        { name: "feature", srcPath: "./feature" }
      ]
    }\n`);
    writeFile(path.join(multiModuleRoot, "entry", "src", "main", "ets", "Entry.ets"), "export class Entry {}\n");
    writeFile(path.join(multiModuleRoot, "feature", "src", "main", "ets", "Feature.ets"), "export class Feature {}\n");
    assert.deepStrictEqual(discoverArkTsSourceDirs(multiModuleRoot), ["."], "Harmony multi-module projects should keep one project-level Scene");
    assert.deepStrictEqual(
        discoverArkTsSourceDirs(multiModuleRoot, { preferProjectRootForMultiModule: false }),
        ["entry/src/main/ets", "feature/src/main/ets"],
        "callers can still request raw source directories for sharded probes",
    );

    assert.deepStrictEqual(
        normalizeSourceDirsForCli(["entry\\src\\main\\ets\\", "entry/src/main/ets", "."]),
        ["entry/src/main/ets", "."],
    );

    const fallbackRoot = path.join(root, "fallback");
    writeFile(path.join(fallbackRoot, "Only.ets"), "export class Only {}\n");
    assert.deepStrictEqual(discoverArkTsSourceDirs(fallbackRoot), ["."]);

    console.log("PASS test_source_discovery");
}

main();
