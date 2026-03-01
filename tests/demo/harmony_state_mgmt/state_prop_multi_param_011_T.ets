import { Prop, State, taint } from "./taint_mock";

class Carrier011 {
    @State()
    title: string = "";
}

class Child011 {
    @Prop()
    title: string = "";

    constructor(payload: Carrier011, _unused: Carrier011) {
        this.title = payload.title;
    }

    build(): void {
        taint.Sink(this.title);
    }
}

class Parent011 {
    @State()
    title: string = "";

    build(): void {
        const taintedPayload = new Carrier011();
        taintedPayload.title = this.title;
        const safePayload = new Carrier011();
        safePayload.title = "safe";
        const child = new Child011(taintedPayload, safePayload);
        child.build();
    }
}

export function state_prop_multi_param_011_T(taint_src: string): void {
    const p = new Parent011();
    p.title = taint_src;
    p.build();
}
