import { Consume, Provide, taint } from "./taint_mock";

class Leaf004 {
    @Consume("token")
    token: string = "";

    build(): void {
        taint.Sink(this.token);
    }
}

class Mid004 {
    build(): void {
        const leaf = new Leaf004();
        leaf.build();
    }
}

class Root004 {
    @Provide("token")
    token: string = "";

    build(): void {
        const mid = new Mid004();
        mid.build();
    }
}

export function provide_consume_deep_chain_004_T(taint_src: string): void {
    const r = new Root004();
    r.token = taint_src;
    r.build();
}

