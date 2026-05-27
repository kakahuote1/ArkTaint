import * as fs from "fs";
import * as path from "path";
import { validateAssetDocument } from "../../core/assets/schema";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function main(): void {
    const root = path.resolve("src/models/kernel/arkmain");
    const files = collectJsonFiles(root);
    assert(files.length >= 2, "expected built-in arkmain asset files");
    for (const file of files) {
        const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
        const validation = validateAssetDocument(parsed);
        assert(validation.valid, `${file} failed asset validation: ${validation.errors.join("; ")}`);
        assert(parsed.plane === "arkmain", `${file} must use plane=arkmain`);
        assert(parsed.status === "official", `${file} must be official`);
        assert(Array.isArray(parsed.effectTemplates) && parsed.effectTemplates.length > 0, `${file} must declare effectTemplates`);
        assert(parsed.effectTemplates.every((template: any) => template.kind === "core.capability"), `${file} must use controlled core capability templates`);

        const serialized = JSON.stringify(parsed);
        for (const forbidden of ["schemaVersion", "coverageSurfaces", "semanticsRef", "semantics.effects", "\"overrideContracts\"", "\"declarationContracts\""]) {
            if (forbidden === "\"overrideContracts\"" || forbidden === "\"declarationContracts\"") {
                assert(!serialized.startsWith(`{${forbidden}`), `${file} must not keep ${forbidden} as top-level legacy field`);
                continue;
            }
            assert(!serialized.includes(forbidden), `${file} contains forbidden legacy marker ${forbidden}`);
        }
    }
    console.log(`PASS test_arkmain_assets_v2_schema files=${files.length}`);
}

function collectJsonFiles(root: string): string[] {
    const out: string[] = [];
    const queue = [root];
    for (let head = 0; head < queue.length; head++) {
        const current = queue[head];
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                queue.push(fullPath);
            } else if (entry.isFile() && entry.name.endsWith(".json")) {
                out.push(fullPath);
            }
        }
    }
    return out.sort((a, b) => a.localeCompare(b));
}

main();
