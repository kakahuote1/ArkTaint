import { Router, taint } from "./taint_mock";

class TargetPage005 {
    onPageShow(): void {
        const params = Router.getParams();
        taint.Sink(params);
    }
}

class SourcePage005 {
    build(): void {
        Router.pushUrl({
            url: "pages/target",
            params: taint.Source(),
        });
    }
}

export function page_build_to_route_show_005_T(): void {
    void SourcePage005;
    void TargetPage005;
}

