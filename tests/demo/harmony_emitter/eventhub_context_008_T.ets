import { UIContext, taint } from "./taint_mock";

export function eventhub_context_008_T(taint_src: string): void {
    const ctx = new UIContext();
    ctx.eventHub.on("ready", (payload: string): void => {
        taint.Sink(payload);
    });
    ctx.eventHub.emit("ready", taint_src);
}

