import * as assert from "assert";
import * as crypto from "crypto";
import * as path from "path";
import { buildContextPack, dedupeKeepOrder, extractSignalsFromRaw, renderContextPackMarkdown } from "../../tools/context_pack";
import { validateSkills } from "../../tools/skills_validate";

function sha256(s: string): string {
    return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

function main(): void {
    const repoRoot = path.resolve(__dirname, "..", "..", "..");

    const skillsReport = validateSkills("docs/skills/registry.json", repoRoot);
    const skillErrors = skillsReport.issues.filter(i => i.severity === "error");
    assert.strictEqual(skillErrors.length, 0, `skills:validate errors: ${skillErrors.map(e => e.message).join("; ")}`);

    const raw = [
        "decision: use approach A",
        "Decision: use approach A",
        "next: run tests",
        "hypothesis: flaky CI",
    ].join("\n");
    const sig = extractSignalsFromRaw(raw);
    assert.deepStrictEqual(sig.decisions, ["use approach A"]);
    assert.deepStrictEqual(dedupeKeepOrder(["a", "A", "b"]), ["a", "b"]);

    const frozenTime = "2026-04-21T00:00:00.000Z";
    const state = {
        Goal: "legacy key",
        activeSkills: ["arktaint/rule-authoring"],
        decisions: ["d1"],
        filesTouched: ["a.ts", "b.ts"],
        lastCommands: [{ cmd: "npm run test:rules", result: "pass" }],
    };
    const pack = buildContextPack({
        state,
        rawText: raw,
        generatedAt: frozenTime,
    });
    assert.strictEqual(pack.normalizedState.goal, "legacy key");
    assert.deepStrictEqual(pack.normalizedState.active_skills, ["arktaint/rule-authoring"]);

    const full = renderContextPackMarkdown(pack, {});
    const r2 = renderContextPackMarkdown(pack, {});
    assert.strictEqual(full.markdown, r2.markdown, "render should be deterministic for same pack");
    assert.strictEqual(full.truncation, undefined);

    const h1 = sha256(full.markdown);
    const h2 = sha256(r2.markdown);
    assert.strictEqual(h1, h2);

    const small = renderContextPackMarkdown(pack, { maxChars: 800 });
    assert.ok(small.markdown.length <= full.markdown.length, "budgeted render should not grow vs full");
    assert.ok(small.markdown.includes("legacy") || small.markdown.includes("goal"), "must-keep goal should remain visible");
    if (full.markdown.length > 800) {
        assert.ok(small.truncation !== undefined, "truncation metadata when full output exceeds budget");
    }

    const tiny = renderContextPackMarkdown(pack, { maxChars: 200 });
    assert.ok(
        tiny.markdown.includes("active_skills") || tiny.markdown.includes("rule-authoring"),
        "must-keep skills should appear in JSON section under tight budget",
    );
    assert.ok(tiny.markdown.length <= 200, `hard minimal path must respect maxChars, got ${tiny.markdown.length}`);

    const micro = renderContextPackMarkdown(pack, { maxChars: 50 });
    assert.ok(micro.markdown.length <= 50, `extreme budget must be honored, got ${micro.markdown.length}`);

    console.log("PASS test_context_skills_tooling");
}

main();
