import { GlobalContext, taint } from "./taint_mock";

export function globalcontext_getobject_015_T(taint_src: string): void {
    const ctx = GlobalContext.getContext();
    ctx.setObject("token", taint_src);
    taint.Sink(ctx.getObject("token"));
}
