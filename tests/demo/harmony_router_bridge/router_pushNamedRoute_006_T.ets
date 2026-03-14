import { Router, taint } from "./taint_mock";

class NamedPage {
    static render(): void {
        const params = Router.getParams();
        taint.Sink(params);
    }
}

export function router_pushNamedRoute_006_T(taint_src: string): void {
    Router.pushNamedRoute({ name: "Detail", params: taint_src });
    NamedPage.render();
}
