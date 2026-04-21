import { Prop, State, taint } from "./taint_mock";

class Carrier010 {
    @State()
    title: string = "";
}

class Child010 {
    @Prop()
    title: string = "";

    constructor(payload: Carrier010, _unused: string) {
        this.title = payload.title;
    }

    build(): void {
        taint.Sink(this.title);
    }
}

class Parent010 {
    @State()
    title: string = "";

    build(): void {
        const safePayload = new Carrier010();
        safePayload.title = "safe";
        const child = new Child010(safePayload, this.title);
        child.build();
    }
}

export function state_prop_multi_param_010_F(taint_src: string): void {
    const p = new Parent010();
    p.title = taint_src;
    p.build();
}
