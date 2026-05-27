import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import { parseArgs } from "../../cli/analyzeCliOptions";
import { runAnalyzeCliCommand } from "../../cli/analyze";
import { writeLlmConfigFile } from "../../cli/llmConfig";
import { resolvedAsset, ruleTransferAsset, vaultHandoffAsset, withSurfaceModulePath } from "../helpers/SemanticFlowMockAssetDecisions";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function readSummary(outputDir: string): any {
    return JSON.parse(fs.readFileSync(path.join(outputDir, "summary", "summary.json"), "utf8"));
}

function readJson(absPath: string): any {
    return JSON.parse(fs.readFileSync(absPath, "utf8"));
}

function writeJson(absPath: string, value: unknown): void {
    fs.writeFileSync(absPath, JSON.stringify(value, null, 2), "utf8");
}

function promotePublishedAsset(absPath: string, reviewedBy: string): void {
    const asset = readJson(absPath);
    asset.status = "reviewed";
    asset.provenance = {
        ...(asset.provenance || {}),
        source: "manual",
        reviewedBy,
    };
    for (const surface of asset.surfaces || []) {
        surface.provenance = {
            ...(surface.provenance || {}),
            source: "analyzer",
        };
    }
    writeJson(absPath, asset);
}

function writeFixture(projectDir: string): void {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, "model_project.ets"), [
        "class UIAbility {",
        "  onCreate(want: string): void {}",
        "}",
        "",
        "class Pipe {",
        "  pass(value: string): string {",
        "    return value;",
        "  }",
        "}",
        "",
        "class Vault {",
        "  put(key: string, value: string): void {}",
        "  get(key: string): string {",
        "    return '';",
        "  }",
        "}",
        "",
        "class DemoAbility extends UIAbility {",
        "  onCreate(want: string): void {",
        "    const pipe = new Pipe();",
        "    const vault = new Vault();",
        "    const forwarded = pipe.pass(want);",
        "    vault.put('token', forwarded);",
        "    const restored = vault.get('token');",
        "    console.info(restored);",
        "  }",
        "}",
        "",
    ].join("\n"), "utf8");
}

async function createMockServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
    const server = http.createServer((req, res) => {
        if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
            res.statusCode = 404;
            res.end("not found");
            return;
        }
        let body = "";
        req.on("data", chunk => {
            body += chunk.toString();
        });
        req.on("end", () => {
            const user = JSON.parse(body).messages?.find((item: any) => item.role === "user")?.content || "";
            const surface = String(user).match(/^surface:\s*(.+)$/m)?.[1]?.trim();
            const owner = String(user).match(/^owner:\s*(.+)$/m)?.[1]?.trim();
            const modulePath = modulePathFromPrompt(String(user));
            const sourceFile = String(user).match(/^sourceFile:\s*(.+)$/m)?.[1]?.trim();
            let decision: Record<string, unknown>;
            if (surface === "onCreate" && owner?.includes("DemoAbility")) {
                decision = {
                    status: "reject",
                    reason: "official ArkMain lifecycle is covered by built-in assets",
                };
            } else if (surface === "pass" && owner?.includes("Pipe")) {
                decision = resolvedAsset(withSurfaceModulePath(ruleTransferAsset("Pipe", "pass", 1), modulePath, sourceFile));
            } else if (surface === "put" && owner?.includes("Vault")) {
                decision = resolvedAsset(withSurfaceModulePath(vaultHandoffAsset("model_project_reuse"), modulePath, sourceFile));
            } else {
                decision = {
                    status: "reject",
                    reason: "not relevant",
                };
            }
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({
                choices: [{ message: { content: JSON.stringify(decision) } }],
            }));
        });
    });

    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    assert(address && typeof address === "object", "failed to start mock model project server");
    return {
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise<void>((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
        }),
    };
}

function modulePathFromPrompt(prompt: string): string | undefined {
    const signature = prompt.match(/signature[:=]\s*([^\n]+)/)?.[1]?.trim();
    const modulePart = signature?.match(/^@?([^:]+):/)?.[1]?.trim();
    return modulePart || undefined;
}

async function main(): Promise<void> {
    const root = path.resolve("tmp/test_runs/analyze/model_project_reuse/latest");
    const projectDir = path.join(root, "project");
    const llmConfigPath = path.join(root, "llm.json");
    const modelRoot = path.join(root, "assets");
    const autoOutputDir = path.join(root, "auto_model");
    const autoReuseOutputDir = path.join(root, "auto_model_reuse");
    const reuseOutputDir = path.join(root, "reuse");
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });
    writeFixture(projectDir);

    const server = await createMockServer();
    writeLlmConfigFile({
        activeProfile: "test",
        profiles: {
            test: {
                provider: "mock",
                baseUrl: server.baseUrl,
                model: "mock-model-project",
                apiKey: "model-project-test-key",
            },
        },
    }, llmConfigPath);

    try {
        await runAnalyzeCliCommand(parseArgs([
            "--repo", projectDir,
            "--sourceDir", ".",
            "--autoModel",
            "--publish-model", "shared_demo",
            "--llmConfig", llmConfigPath,
            "--llmProfile", "test",
            "--model", "mock-model-project",
            "--model-root", modelRoot,
            "--no-incremental",
            "--outputDir", autoOutputDir,
        ]));

        const publishedRuleAsset = path.join(modelRoot, "project", "shared_demo", "rules", "semanticflow.rules.json");
        const publishedModuleAsset = path.join(modelRoot, "project", "shared_demo", "modules", "semanticflow.modules.json");
        assert(fs.existsSync(publishedRuleAsset), "published rule asset missing");
        assert(fs.existsSync(publishedModuleAsset), "published module asset missing");
        assert(!fs.existsSync(path.join(modelRoot, "project", "shared_demo", "arkmain", "semanticflow.arkmain.json")), "built-in arkmain lifecycle should not publish project arkmain specs");
        promotePublishedAsset(publishedRuleAsset, "test-reviewer");
        promotePublishedAsset(publishedModuleAsset, "test-reviewer");

        await runAnalyzeCliCommand(parseArgs([
            "--repo", projectDir,
            "--sourceDir", ".",
            "--model-root", modelRoot,
            "--enable-model", "shared_demo",
            "--no-incremental",
            "--outputDir", reuseOutputDir,
        ]));

        const summary = readSummary(reuseOutputDir);
        assert(summary.summary.withSeeds > 0, `expected reuse analyze withSeeds > 0, got ${summary.summary.withSeeds}`);
        assert(summary.summary.totalFlows > 0, `expected reuse analyze totalFlows > 0, got ${summary.summary.totalFlows}`);

        await runAnalyzeCliCommand(parseArgs([
            "--repo", projectDir,
            "--sourceDir", ".",
            "--autoModel",
            "--llmConfig", llmConfigPath,
            "--llmProfile", "test",
            "--model", "mock-model-project",
            "--model-root", modelRoot,
            "--enable-model", "shared_demo",
            "--no-incremental",
            "--outputDir", autoReuseOutputDir,
        ]));

        const semanticflowSummary = readJson(path.join(autoReuseOutputDir, "summary.json"));
        assert(semanticflowSummary.itemCount === 0, `expected no remaining semanticflow items after reviewed project assets and kernel coverage, got ${semanticflowSummary.itemCount}`);
        assert(semanticflowSummary.ruleKnownCoveredCount === 5, `expected enabled shared_demo pack plus kernel assets to cover all semanticflow rule candidates, got ${semanticflowSummary.ruleKnownCoveredCount}`);
        const semanticflowSession = readJson(path.join(autoReuseOutputDir, "session.json"));
        assert(semanticflowSession.items.length === 0, `expected zero semanticflow session items after known filtering, got ${semanticflowSession.items.length}`);
        const autoReuseSummary = readSummary(autoReuseOutputDir);
        assert(autoReuseSummary.summary.withSeeds > 0, `expected auto-model reuse analyze withSeeds > 0, got ${autoReuseSummary.summary.withSeeds}`);
        assert(autoReuseSummary.summary.totalFlows > 0, `expected auto-model reuse analyze totalFlows > 0, got ${autoReuseSummary.summary.totalFlows}`);

        console.log("PASS test_analyze_model_project_reuse");
    } finally {
        await server.close();
    }
}

main().catch(error => {
    console.error("FAIL test_analyze_model_project_reuse");
    console.error(error);
    process.exit(1);
});
