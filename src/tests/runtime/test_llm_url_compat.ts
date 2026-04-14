import * as http from "http";
import { OpenAICompatibleClient } from "../../core/llm/OpenAICompatibleClient";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

async function main(): Promise<void> {
    let seenPath = "";
    const server = http.createServer((req, res) => {
        seenPath = req.url || "";
        if (req.method !== "POST" || req.url !== "/api/paas/v4/chat/completions") {
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
    assert(address && typeof address === "object", "failed to start url compat server");

    try {
        const client = new OpenAICompatibleClient({
            baseUrl: `http://127.0.0.1:${address.port}/api/paas/v4`,
            apiKey: "demo",
            timeoutMs: 30_000,
            connectTimeoutMs: 30_000,
        });
        const response = await client.complete({
            model: "glm-4.5-flash",
            system: "system",
            user: "user",
        });
        assert(response.text.includes("\"status\":\"done\""), `unexpected response text: ${response.text}`);
        assert(seenPath === "/api/paas/v4/chat/completions", `unexpected request path: ${seenPath}`);
        console.log("PASS test_llm_url_compat");
    } finally {
        await new Promise<void>((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
        });
    }
}

main().catch(error => {
    console.error("FAIL test_llm_url_compat");
    console.error(error);
    process.exit(1);
});
