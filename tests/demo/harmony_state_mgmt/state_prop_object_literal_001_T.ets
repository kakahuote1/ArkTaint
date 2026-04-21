import { Prop, State, taint } from "./taint_mock";

class Child001 {
    @Prop()
    title: string = "";

    build(): void {
        taint.Sink(this.title);
    }
}

class Parent001 {
    @State()
    title: string = "";

    build(): void {
        const c = new Child001({ title: this.title });
        c.build();
    }
}

export function state_prop_object_literal_001_T(taint_src: string): void {
    const p = new Parent001();
    p.title = taint_src;
    p.build();
}
