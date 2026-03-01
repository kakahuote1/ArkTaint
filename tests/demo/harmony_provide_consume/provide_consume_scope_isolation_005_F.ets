import { Consume, Provide, taint } from "./taint_mock";

class Leaf005 {
    @Consume("token")
    token: string = "";

    build(): void {
        taint.Sink(this.token);
    }
}

class Root005 {
    @Provide("other")
    token: string = "";

    build(): void {
        const leaf = new Leaf005();
        leaf.build();
    }
}

export function provide_consume_scope_isolation_005_F(taint_src: string): void {
    const r = new Root005();
    r.token = taint_src;
    r.build();
}

