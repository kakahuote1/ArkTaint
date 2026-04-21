import * as fs from "fs";
import * as path from "path";
import { runLlmCli } from "../../cli/llm";
import { readLlmConfigFile } from "../../cli/llmConfig";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

async function main(): Promise<void> {
    const root = path.resolve("tmp/test_runs/runtime/llm_cli/latest");
    const configPath = path.join(root, "llm.json");
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });

    await runLlmCli([
        "--config", configPath,
        "--profile", "test",
        "--endpoint", "https://example.test/custom/chat/completions?api-version=2026-04-01",
        "--model", "demo-model",
        "--apiKey", "demo-secret-key",
        "--apiKeyHeader", "api-key",
        "--apiKeyPrefix=",
    ]);

    const config = readLlmConfigFile(configPath);
    assert(config, "expected llm config to be written");
    const profile = config.profiles.test;
    assert(profile, "expected test profile to exist");
    assert(profile.endpoint === "https://example.test/custom/chat/completions?api-version=2026-04-01", `unexpected endpoint: ${profile.endpoint}`);
    assert(profile.baseUrl === undefined, `expected baseUrl to stay empty, got: ${profile.baseUrl}`);
    assert(profile.apiKeyHeader === "api-key", `unexpected apiKeyHeader: ${profile.apiKeyHeader}`);
    assert(profile.apiKeyPrefix === "", `unexpected apiKeyPrefix: ${profile.apiKeyPrefix}`);
    assert(!profile.apiKey, "expected apiKey to be removed from main config");
    assert(typeof profile.apiKeyFile === "string" && profile.apiKeyFile.length > 0, "expected apiKeyFile to be set");
    assert(fs.existsSync(profile.apiKeyFile!), `missing api key file: ${profile.apiKeyFile}`);
    const secret = fs.readFileSync(profile.apiKeyFile!, "utf-8").trim();
    assert(secret === "demo-secret-key", `unexpected api key file content: ${secret}`);

    console.log("PASS test_llm_cli");
}

main().catch(error => {
    console.error("FAIL test_llm_cli");
    console.error(error);
    process.exit(1);
});
