import { Prop, taint } from "./taint_mock";

class Child002 {
    @Prop()
    title: string = "";

    build(): void {
        taint.Sink(this.title);
    }
}

class Parent002 {
    title: string = "";

    build(): void {
        const c = new Child002({ title: this.title });
        c.build();
    }
}

export function state_prop_non_state_field_002_F(taint_src: string): void {
    const p = new Parent002();
    p.title = taint_src;
    p.build();
}
