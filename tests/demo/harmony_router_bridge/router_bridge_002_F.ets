import { Router, taint } from "./taint_mock";

class RouterDetailPage002 {
    build(): void {
        const params = Router.getParams();
        taint.Sink("safe_" + params);
    }
}

export function router_bridge_002_F(taint_src: string): void {
    Router.pushUrl({ url: "Detail", params: "safe_literal" });
    const detail = new RouterDetailPage002();
    detail.build();
    const guard = "guard_safe";
    taint.Sink("safe_only_" + guard.length);
    const _unused = taint_src;
    void _unused;
}
