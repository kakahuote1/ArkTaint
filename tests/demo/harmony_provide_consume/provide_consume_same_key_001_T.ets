import { Consume, Provide, taint } from "./taint_mock";

class Child001 {
    @Consume("token")
    token: string = "";

    build(): void {
        taint.Sink(this.token);
    }
}

class Parent001 {
    @Provide("token")
    token: string = "";

    build(): void {
        const child = new Child001();
        child.build();
    }
}

export function provide_consume_same_key_001_T(taint_src: string): void {
    const p = new Parent001();
    p.token = taint_src;
    p.build();
}
