import * as fs from "fs";
import * as path from "path";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function walkRuleFiles(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) {
        return out;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.resolve(dir, entry.name);
        if (entry.isDirectory()) {
            walkRuleFiles(fullPath, out);
            continue;
        }
        if (entry.isFile() && entry.name.endsWith(".json")) {
            out.push(fullPath);
        }
    }
    return out;
}

function collectGovernanceFields(filePath: string): string[] {
    const raw = fs.readFileSync(filePath, "utf-8");
    const hits: string[] = [];
    if (/"layer"\s*:/.test(raw)) hits.push("layer");
    if (/"family"\s*:/.test(raw)) hits.push("family");
    if (/"tier"\s*:/.test(raw)) hits.push("tier");
    return hits;
}

async function main(): Promise<void> {
    const files = [
        ...walkRuleFiles(path.resolve("src/models")),
        ...walkRuleFiles(path.resolve("tests/rules")),
    ].sort();

    const offenders: Array<{ file: string; fields: string[] }> = [];
    for (const file of files) {
        const fields = collectGovernanceFields(file);
        if (fields.length > 0) {
            offenders.push({
                file: path.relative(process.cwd(), file).replace(/\\/g, "/"),
                fields,
            });
        }
    }

    assert(
        offenders.length === 0,
        `rule authoring files still contain explicit governance fields: ${offenders.map(item => `${item.file}[${item.fields.join(",")}]`).join("; ")}`
    );

    console.log("====== Rule Governance Hidden Fields Audit ======");
    console.log(`audited_files=${files.length}`);
    console.log("authoring_governance_fields=PASS");
}

main().catch(error => {
    console.error("FAIL test_rule_governance_hidden_fields");
    console.error(error);
    process.exit(1);
});

