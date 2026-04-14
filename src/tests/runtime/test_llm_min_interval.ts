import * as http from "http";
import { OpenAICompatibleClient } from "../../core/llm/OpenAICompatibleClient";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

async function main(): Promise<void> {
    const starts: number[] = [];
    const server = http.createServer((req, res) => {
        starts.push(Date.now());
        if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
            res.statusCode = 404;
            res.end("not found");
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
    assert(address && typeof address === "object", "failed to start min interval server");

    try {
        const client = new OpenAICompatibleClient({
            baseUrl: `http://127.0.0.1:${address.port}/v1`,
            apiKey: "demo",
            minIntervalMs: 200,
            timeoutMs: 30_000,
            connectTimeoutMs: 30_000,
        });
        await Promise.all([
            client.complete({ model: "demo-model", system: "s", user: "u1" }),
            client.complete({ model: "demo-model", system: "s", user: "u2" }),
        ]);
        assert(starts.length === 2, `expected 2 requests, got ${starts.length}`);
        const delta = starts[1] - starts[0];
        assert(delta >= 180, `expected requests to be spaced by minIntervalMs, got delta=${delta}`);
        console.log("PASS test_llm_min_interval");
    } finally {
        await new Promise<void>((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
        });
    }
}

main().catch(error => {
    console.error("FAIL test_llm_min_interval");
    console.error(error);
    process.exit(1);
});
