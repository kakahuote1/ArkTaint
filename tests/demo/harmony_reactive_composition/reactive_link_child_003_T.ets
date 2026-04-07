import { Link, State, taint } from "./taint_mock";

class Child003 {
    @Link token: string = "";

    build(): void {
        taint.Sink(this.token);
    }
}

class Parent003 {
    @State token: string = "";

    build(): void {
        this.token = taint.Source();
        const child = new Child003({ token: this.token });
        child.build();
    }
}

export function reactive_link_child_003_T(): void {
    const parent = new Parent003();
    parent.build();
}

