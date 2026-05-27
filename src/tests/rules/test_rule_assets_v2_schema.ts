import * as fs from "fs";
import * as path from "path";
import { validateAssetDocument } from "../../core/assets/schema";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        if (entry.isFile() && entry.name.endsWith(".rules.json")) out.push(full);
    }
    return out.sort((a, b) => a.localeCompare(b));
}

function main(): void {
    const root = path.resolve("src/models/kernel/rules");
    const files = walk(root);
    assert(files.length > 0, "expected kernel rule asset files");

    for (const file of files) {
        const raw = JSON.parse(fs.readFileSync(file, "utf-8").replace(/^\uFEFF/, ""));
        const result = validateAssetDocument(raw);
        assert(result.valid, `${file} should be a valid v2 asset: ${result.errors.join("; ")}`);
        const text = fs.readFileSync(file, "utf-8");
        for (const forbidden of ["schemaVersion", "coverageSurfaces", "\"sources\"", "\"sinks\"", "\"transfers\"", "\"sanitizers\""]) {
            assert(!text.includes(forbidden), `${file} contains forbidden old rule field ${forbidden}`);
        }
    }

    console.log(`PASS test_rule_assets_v2_schema files=${files.length}`);
}

main();
