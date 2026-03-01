import { Prop, State, taint } from "./taint_mock";

class Child009 {
    @Prop()
    title: string = "";

    build(): void {
        taint.Sink(this.title);
    }
}

class Parent009 {
    @State()
    title: string = "";

    build(): void {
        const child = new Child009({ title: this.title });
        child.title = "safe";
    }
}

export function state_prop_child_not_built_009_F(taint_src: string): void {
    const p = new Parent009();
    p.title = taint_src;
    p.build();
}

