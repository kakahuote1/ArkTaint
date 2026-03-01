import { Router, taint } from "./taint_mock";

class RouterPage001 {
    build(): void {
        const p = Router.getParams();
        taint.Sink(p);
    }
}

export function router_getparams_direct_001_T(): void {
    Router.pushUrl({ url: "detail", params: "tainted" });
    const page = new RouterPage001();
    page.build();
}
