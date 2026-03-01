import { Prop, State, taint } from "./taint_mock";

class Child008Inner {
    @Prop()
    title: string = "";

    build(): void {
        taint.Sink(this.title);
    }
}

class Child008Outer {
    @Prop()
    title: string = "";

    build(): void {
        const inner = new Child008Inner({ title: this.title });
        inner.build();
    }
}

class Parent008 {
    @State()
    title: string = "";

    build(): void {
        const outer = new Child008Outer({ title: this.title });
        outer.build();
    }
}

export function state_prop_transit_child_008_T(taint_src: string): void {
    const p = new Parent008();
    p.title = taint_src;
    p.build();
}
