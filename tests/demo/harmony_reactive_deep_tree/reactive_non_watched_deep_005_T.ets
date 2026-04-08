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
    void ChildView005;
    void ParentPage005;
}
