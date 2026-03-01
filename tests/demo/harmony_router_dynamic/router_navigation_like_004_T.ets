import { Router, taint } from "./taint_mock";

class Detail004 {
    build(): void {
        const params = Router.getParams();
        taint.Sink(params);
    }
}

export function router_navigation_like_004_T(): void {
    Router.pushUrl({ url: "Detail", params: "token_from_nav" });
    const detail = new Detail004();
    detail.build();
}

