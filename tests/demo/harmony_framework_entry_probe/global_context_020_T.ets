import { GlobalContext, taint } from "./taint_mock";

class GlobalContextPage020 {
    build(): void {
        const ctx = GlobalContext.getContext();
        ctx.setObject("token", taint.Source());
        taint.Sink(ctx.getObject("token"));
    }
}

export function global_context_020_T(): void {
    void GlobalContextPage020;
}
