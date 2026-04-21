import { Prop, State, taint } from "./taint_mock";

class Child007 {
    @Prop()
    title: string = "";

    build(): void {
        taint.Sink(this.title);
    }
}

class Parent007 {
    @State()
    title: string = "";

    build(): void {
        const c = new Child007({ title: this.title });
        c.build();
    }
}

export function state_prop_direct_variant_007_T(taint_src: string): void {
    const p = new Parent007();
    p.title = taint_src;
    p.build();
}

