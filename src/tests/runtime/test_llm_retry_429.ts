import * as http from "http";
import { OpenAICompatibleClient } from "../../core/llm/OpenAICompatibleClient";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

async function main(): Promise<void> {
    let attempts = 0;
    const server = http.createServer((req, res) => {
        attempts++;
        if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
            res.statusCode = 404;
            res.end("not found");
            return;
        }
        if (attempts < 3) {
            res.statusCode = 429;
            res.setHeader("Retry-After", "0");
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({
                error: {
                    code: "1302",
                    message: "rate limited",
                },
            }));
            return;
        }
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({
            choices: [
                {
                    message: {
                        content: "OK",
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
    assert(address && typeof address === "object", "failed to start retry server");

    try {
        const client = new OpenAICompatibleClient({
            baseUrl: `http://127.0.0.1:${address.port}/v1`,
            apiKey: "demo",
            timeoutMs: 30_000,
            connectTimeoutMs: 30_000,
        });
        const response = await client.complete({
            model: "demo-model",
            system: "system",
            user: "user",
        });
        assert(response.text === "OK", `unexpected response text: ${response.text}`);
        assert(attempts === 3, `expected 3 attempts, got ${attempts}`);
        console.log("PASS test_llm_retry_429");
    } finally {
        await new Promise<void>((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
        });
    }
}

main().catch(error => {
    console.error("FAIL test_llm_retry_429");
    console.error(error);
    process.exit(1);
});
