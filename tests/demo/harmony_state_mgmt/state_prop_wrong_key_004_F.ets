import { Prop, State, taint } from "./taint_mock";

class Child004 {
    @Prop()
    subtitle: string = "";

    build(): void {
        taint.Sink(this.subtitle);
    }
}

class Parent004 {
    @State()
    title: string = "";

    build(): void {
        const c = new Child004({ wrongKey: this.title });
        c.build();
    }
}

export function state_prop_wrong_key_004_F(taint_src: string): void {
    const p = new Parent004();
    p.title = taint_src;
    p.build();
}
