import { Link, State, taint } from "./taint_mock";

class Child005 {
    @Link()
    title: string = "";

    build(): void {
        taint.Sink("safe_" + this.title);
    }
}

class Parent005 {
    @State()
    title: string = "const";

    build(): void {
        const c = new Child005({ title: this.title });
        c.build();
    }
}

export function link_prop_mix_005_F(taint_src: string): void {
    const _unused = taint_src;
    const p = new Parent005();
    p.build();
}

