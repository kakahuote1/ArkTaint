import { Router, taint } from "./taint_mock";

class ReplacePage {
    static render(): void {
        const params = Router.getParams();
        taint.Sink(params);
    }
}

export function router_replaceUrl_005_T(taint_src: string): void {
    Router.replaceUrl({ url: "Detail", params: taint_src });
    ReplacePage.render();
}
