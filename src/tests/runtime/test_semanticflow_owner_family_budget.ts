import * as fs from "fs";
import * as path from "path";
import { enrichNoCandidateItemsWithCallsiteSlices, normalizeNoCandidateItem } from "../../core/model/callsite/callsiteContextSlices";
import { buildSemanticFlowRuleCandidateItem } from "../../core/semanticflow/SemanticFlowAdapters";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function writeFixture(projectDir: string): void {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(projectDir, "entry", "src", "main", "ets", "router"), { recursive: true });
    fs.writeFileSync(path.join(projectDir, "entry", "src", "main", "ets", "router", "Router.ets"), [
        "import router from '@ohos.router'",
        "import { LogUtil } from '@pura/harmony-utils';",
        "",
        "export class Router {",
        "  public static replace(options: RouterOptions) {",
        "    router.replaceUrl(",
        "      { url: options.url, params: options.params },",
        "      router.RouterMode.Standard)",
        "      .then(options.success)",
        "      .catch(options.error)",
        "  }",
        "",
        "  public static push(options: RouterOptions) {",
        "    router.pushUrl(",
        "      { url: options.url, params: options.params },",
        "      router.RouterMode.Standard",
        "    )",
        "      .then(() => {",
        "        if (options.success) {",
        "          options.success()",
        "        }",
        "        LogUtil.debug('route ok')",
        "      })",
        "      .catch((error: Error) => {",
        "        if (options.error) {",
        "          options.error(error)",
        "        }",
        "      })",
        "  }",
        "",
        "  public static getParams(): Object {",
        "    return router.getParams()",
        "  }",
        "}",
        "",
    ].join("\n"), "utf8");
}

async function main(): Promise<void> {
    const projectDir = path.resolve("tmp/test_runs/runtime/semanticflow_owner_family_budget/latest/project");
    writeFixture(projectDir);

    const enriched = enrichNoCandidateItemsWithCallsiteSlices({
        repoRoot: projectDir,
        sourceDirs: ["entry/src/main/ets/router"],
        items: [normalizeNoCandidateItem({
            callee_signature: "@ets/router/Router.ets: Router.[static]getParams()",
            method: "getParams",
            invokeKind: "static",
            argCount: 0,
            sourceFile: "ets/router/Router.ets",
            count: 5,
            topEntries: ["@arkMain"],
        })],
        maxItems: 1,
        maxExamplesPerItem: 1,
        contextRadius: 4,
        cfgNeighborRadius: 2,
    });

    const slice = buildSemanticFlowRuleCandidateItem(enriched[0]).initialSlice;
    const labels = slice.snippets.map(snippet => snippet.label);

    assert(labels.length === 3, `expected 3 snippets, got ${labels.length}: ${labels.join(",")}`);
    assert(labels[0] === "method", `expected method snippet first, got ${labels[0]}`);
    assert(labels[1] === "owner-context", `expected owner-context second, got ${labels[1]}`);
    assert(labels[2] === "owner-sibling-push", `expected only strongest owner sibling in round0, got ${labels[2]}`);
    assert((slice.companions || []).includes("push"), "expected push companion");
    assert((slice.companions || []).includes("replace"), "expected replace companion");
    assert(slice.snippets[1].code.includes("import router"), "expected relevant import to stay in owner-context");
    assert(!slice.snippets[1].code.includes("LogUtil"), "owner-context should drop unrelated imports");
    assert(!slice.snippets[2].code.includes("options.success"), "owner sibling should drop callback boilerplate");
    assert(!slice.snippets[2].code.includes("LogUtil.debug"), "owner sibling should drop debug-only calls");

    console.log("PASS test_semanticflow_owner_family_budget");
}

main().catch(error => {
    console.error("FAIL test_semanticflow_owner_family_budget");
    console.error(error);
    process.exit(1);
});
