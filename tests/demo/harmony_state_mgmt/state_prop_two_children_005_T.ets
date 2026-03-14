import { Prop, State, taint } from "./taint_mock";

class Child005A {
    @Prop()
    title: string = "";

    build(): void {
        taint.Sink(this.title);
    }
}

class Child005B {
    @Prop()
    title: string = "";

    build(): void {}
}

class Parent005 {
    @State()
    title: string = "";

    build(): void {
        const c1 = new Child005A({ title: this.title });
        c1.build();

        const c2 = new Child005B({ title: "safe" });
        c2.build();
    }
}

export function state_prop_two_children_005_T(taint_src: string): void {
    const p = new Parent005();
    p.title = taint_src;
    p.build();
}
