import { Component, Link, Router, State, Watch, taint } from "./taint_mock";

@Component
class ChildView002 {
    @Link token: string = "";

    update(token: string): void {
        this.token = token;
    }

    @Watch("token")
    onTokenWatch(): void {
        taint.Sink(this.token);
    }
}

@Component
class ParentPage002 {
    @State token: string = "";

    build(): void {
        Router.pushUrl({ url: "pages/child", params: { token: taint.Source() } });
        this.token = Router.getParams().token;
    }
}

export function reactive_route_link_watch_002_T(): void {
    const parent = new ParentPage002();
    parent.build();
    const child = new ChildView002({ token: parent.token });
    child.onTokenWatch();
}
