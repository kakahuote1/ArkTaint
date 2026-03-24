import { Router, taint } from "./taint_mock";

class TargetPage006 {
    onPageShow(): void {
        const params = Router.getParams();
        void params;
        taint.Sink("safe");
    }
}

class SourcePage006 {
    build(): void {
        Router.pushUrl({
            url: "pages/target",
            params: taint.Source(),
        });
    }
}

export function page_route_safe_006_T(): void {
    void SourcePage006;
    void TargetPage006;
}

