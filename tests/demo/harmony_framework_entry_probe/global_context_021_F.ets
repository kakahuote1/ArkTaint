import { GlobalContext, taint } from "./taint_mock";

class GlobalContextPage021 {
    build(): void {
        const writeCtx = new GlobalContext();
        writeCtx.setObject("token", taint.Source());
        const readCtx = new GlobalContext();
        taint.Sink(readCtx.getObject("token"));
    }
}

export function global_context_021_F(): void {
    void GlobalContextPage021;
}
