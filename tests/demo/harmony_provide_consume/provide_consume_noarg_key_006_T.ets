import { Consume, Provide, taint } from "./taint_mock";

class Child006 {
    @Consume()
    token: string = "";

    build(): void {
        taint.Sink(this.token);
    }
}

class Parent006 {
    @Provide()
    token: string = "";

    build(): void {
        const child = new Child006();
        child.build();
    }
}

export function provide_consume_noarg_key_006_T(taint_src: string): void {
    const p = new Parent006();
    p.token = taint_src;
    p.build();
}
