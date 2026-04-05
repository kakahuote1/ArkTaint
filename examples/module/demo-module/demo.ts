import { defineModule } from "@arktaint/module";

export default defineModule({
    id: "example.demo_module",
    description: "Minimal public-authoring example.",
    setup(ctx) {
        const relay = ctx.bridge.nodeRelay();

        for (const call of ctx.scan.invokes({ methodName: "register", minArgs: 2 })) {
            const callback = call.arg(1);
            if (!callback) continue;
            for (const sourceNodeId of call.argNodeIds(0)) {
                for (const targetNodeId of ctx.callbacks.paramNodeIds(callback, 0, { maxCandidates: 8 })) {
                    relay.connect(sourceNodeId, targetNodeId);
                }
            }
        }

        ctx.debug.summary("Example-DemoModule", {
            scanned_calls: ctx.scan.invokes({ methodName: "register", minArgs: 2 }).length,
        });

        return {
            onFact(event) {
                return relay.emitPreserve(event, "Example-DemoModule");
            },
        };
    },
});
