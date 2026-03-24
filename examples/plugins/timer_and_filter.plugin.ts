import { defineEnginePlugin } from "../../src/core/orchestration/plugins/EnginePlugin";

export default defineEnginePlugin({
    name: "example.timer_and_filter",

    onPropagation(api) {
        api.onCallEdge(event => {
            console.log(`[plugin] ${event.reason}: ${event.callerMethodName} -> ${event.calleeMethodName}`);
        });

        api.replace((input, fallback) => {
            const t0 = Date.now();
            const out = fallback.run(input);
            console.log(`[plugin] propagation_ms=${Date.now() - t0}`);
            return out;
        });
    },

    onResult(api) {
        api.filter(flow => {
            const sinkText = flow.sink?.toString?.() || "";
            return sinkText.includes(".test.") ? null : flow;
        });
    },
});
