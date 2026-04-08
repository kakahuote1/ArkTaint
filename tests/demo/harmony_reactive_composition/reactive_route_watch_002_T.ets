import { Router, State, Watch, taint } from "./taint_mock";

class ReactivePage002 {
    @State token: string = "";

    build(): void {
        Router.pushUrl({ url: "pages/x", params: taint.Source() });
        this.token = Router.getParams();
    }

    @Watch("token")
    onTokenWatch(): void {
        taint.Sink(this.token);
    }
}

export function reactive_route_watch_002_T(): void {
    void ReactivePage002;
}

