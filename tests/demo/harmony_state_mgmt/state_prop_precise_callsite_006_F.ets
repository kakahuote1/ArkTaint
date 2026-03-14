import { Prop, State, taint } from "./taint_mock";

class Child006T {
    @Prop()
    title: string = "";
}

class Child006Safe {
    @Prop()
    title: string = "";
}

class Parent006 {
    @State()
    title: string = "";

    build(): void {
        const taintedChild = new Child006T({ title: this.title });
        const safeChild = new Child006Safe({ title: "safe" });
        taint.Sink(safeChild.title);
        taintedChild.title = "unused";
    }
}

export function state_prop_precise_callsite_006_F(taint_src: string): void {
    const p = new Parent006();
    p.title = taint_src;
    p.build();
}
