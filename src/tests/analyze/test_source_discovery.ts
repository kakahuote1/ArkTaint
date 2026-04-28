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
