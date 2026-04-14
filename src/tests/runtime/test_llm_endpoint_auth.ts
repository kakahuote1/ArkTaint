import * as http from "http";
import { OpenAICompatibleClient } from "../../core/llm/OpenAICompatibleClient";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

async function main(): Promise<void> {
    let seenPath = "";
    let seenApiKey = "";
    let seenAuthorization = "";
    const server = http.createServer((req, res) => {
        seenPath = req.url || "";
        seenApiKey = String(req.headers["api-key"] || "");
        seenAuthorization = String(req.headers.authorization || "");
        if (req.method !== "POST" || req.url !== "/custom/chat/completions?api-version=2026-04-01") {
            res.statusCode = 404;
            res.end("not found");
            return;
        }
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({
            choices: [
                {
                    message: {
                        content: "{\"status\":\"done\"}",
                    },
                },
            ],
        }));
    });

    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve());
    });

    const address = server.address();
    assert(address && typeof address === "object", "failed to start endpoint auth server");

    try {
        const client = new OpenAICompatibleClient({
            endpoint: `http://127.0.0.1:${address.port}/custom/chat/completions?api-version=2026-04-01`,
            apiKey: "demo-secret",
            apiKeyHeader: "api-key",
            apiKeyPrefix: "",
            timeoutMs: 30_000,
            connectTimeoutMs: 30_000,
        });
        const response = await client.complete({
            model: "demo-model",
            system: "system",
            user: "user",
        });
        assert(response.text.includes("\"status\":\"done\""), `unexpected response text: ${response.text}`);
        assert(seenPath === "/custom/chat/completions?api-version=2026-04-01", `unexpected request path: ${seenPath}`);
        assert(seenApiKey === "demo-secret", `unexpected api-key header: ${seenApiKey}`);
        assert(seenAuthorization === "", `unexpected authorization header: ${seenAuthorization}`);
        console.log("PASS test_llm_endpoint_auth");
    } finally {
        await new Promise<void>((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
        });
    }
}

main().catch(error => {
    console.error("FAIL test_llm_endpoint_auth");
    console.error(error);
    process.exit(1);
});
