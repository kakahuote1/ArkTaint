import { GlobalContext, taint } from "./taint_mock";

export function globalcontext_getobject_016_F(taint_src: string): void {
    const ctx = GlobalContext.getContext();
    ctx.setObject("token_alt", taint_src);
    taint.Sink(ctx.getObject("token"));
}
