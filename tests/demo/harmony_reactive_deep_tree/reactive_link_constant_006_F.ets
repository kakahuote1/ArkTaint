import { Link, taint } from "./taint_mock";

class ChildView006 {
    @Link token: string = "";

    @Watch("token")
    onTokenWatch(): void {
        taint.Sink("clean");
    }
}

export function reactive_link_constant_006_F(): void {
    void ChildView006;
}
