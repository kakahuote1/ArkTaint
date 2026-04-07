import { Consume, Provide, State, Watch, taint } from "./taint_mock";

class ChildView003 {
    @Consume("token")
    token: string = "";

    @Watch("token")
    onTokenWatch(): void {
        taint.Sink(this.token);
    }
}

class ParentPage003 {
    @State
    @Provide("token")
    token: string = "";

    build(): void {
        this.token = taint.Source();
        const child = new ChildView003();
        child.onTokenWatch();
    }
}

export function reactive_provide_consume_watch_003_T(): void {
    const parent = new ParentPage003();
    parent.build();
}
