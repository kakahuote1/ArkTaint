import { Link, State, taint } from "./taint_mock";

class ChildView005 {
    @Link token: string = "";

    helper(): void {
        taint.Sink("clean");
    }
}

class ParentPage005 {
    @State token: string = "";

    build(): void {
        this.token = taint.Source();
    }
}

export function reactive_non_watched_deep_005_T(): void {
    const parent = new ParentPage005();
    parent.build();
    const child = new ChildView005({ token: parent.token });
    child.helper();
}
