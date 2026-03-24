import { Router, taint } from "./taint_mock";

class RouterPage001 {
    build(): void {
        const p = Router.getParams();
        taint.Sink(p);
    }
}

export function router_getparams_direct_001_T(taint_src: string): void {
    Router.pushUrl({ url: "detail", params: taint_src });
    const page = new RouterPage001();
    page.build();
}
