import { defineModule } from "@arktaint/module";

export default defineModule({
    id: "example.demo_module",
    description: "Minimal public-authoring example.",
    setup(ctx) {
        const relay = ctx.bridge.nodeRelay();

        for (const call of ctx.scan.invokes({ methodName: "register", minArgs: 2 })) {
            relay.connectInvokeArgToCallbackParam(call, 0, 1, 0, { maxCandidates: 8 });
        }

        ctx.debug.summary("Example-DemoModule", {
            scanned_calls: ctx.scan.invokes({ methodName: "register", minArgs: 2 }).length,
        });

        return {
            onFact(event) {
                return relay.emitPreserve(event, "Example-DemoModule", { allowUnreachableTarget: true });
            },
        };
    },
});
