import { Link, Router, State, Watch, taint } from "./taint_mock";

class ChildView002 {
    @Link token: string = "";

    @Watch("token")
    onTokenWatch(): void {
        taint.Sink(this.token);
    }
}

class ParentPage002 {
    @State token: string = "";

    build(): void {
        Router.pushUrl({ url: "pages/child", params: { token: taint.Source() } });
        this.token = Router.getParams().token;
    }
}

export function reactive_route_link_watch_002_T(): void {
    void ChildView002;
    void ParentPage002;
}
