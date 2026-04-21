import { Consume, Provide, taint } from "./taint_mock";

class Child002 {
    @Consume("token")
    token: string = "";

    build(): void {
        taint.Sink(this.token);
    }
}

class Parent002 {
    @Provide("other")
    token: string = "";

    build(): void {
        const child = new Child002();
        child.build();
    }
}

export function provide_consume_mismatch_key_002_F(taint_src: string): void {
    const p = new Parent002();
    p.token = taint_src;
    p.build();
}
