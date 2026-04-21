import { Prop, State, taint } from "./taint_mock";

class Child003 {
    @Prop()
    subtitle: string = "";

    build(): void {
        taint.Sink(this.subtitle);
    }
}

class Parent003 {
    @State()
    title: string = "";

    build(): void {
        const c = new Child003({ subtitle: this.title });
        c.build();
    }
}

export function state_prop_alias_key_003_T(taint_src: string): void {
    const p = new Parent003();
    p.title = taint_src;
    p.build();
}
