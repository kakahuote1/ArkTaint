import { Link, State, taint } from "./taint_mock";

class Child003 {
    @Link token: string = "";

    render(): void {
        taint.Sink(this.token);
    }
}

class Parent003 {
    @State token: string = "";

    build(): void {
        this.token = taint.Source();
    }
}

export function reactive_link_child_003_T(): void {
    void Parent003;
    void Child003;
}

