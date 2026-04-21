import { Consume, Provide, taint } from "./taint_mock";

class Child003 {
    @Consume("session")
    token: string = "";

    build(): void {
        taint.Sink(this.token);
    }
}

class Parent003 {
    @Provide("session")
    sessionToken: string = "";

    build(): void {
        const child = new Child003();
        child.build();
    }
}

export function provide_consume_alias_003_T(taint_src: string): void {
    const p = new Parent003();
    p.sessionToken = taint_src;
    p.build();
}
