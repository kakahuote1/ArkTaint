import { Router, taint } from "./taint_mock";

class RouterDetailPage001 {
    build(): void {
        const params = Router.getParams();
        taint.Sink(params);
    }
}

export function router_bridge_001_T(taint_src: string): void {
    Router.pushUrl({ url: "Detail", params: taint_src });
    const detail = new RouterDetailPage001();
    detail.build();
}
