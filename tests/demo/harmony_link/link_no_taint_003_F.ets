import { Link, State, taint } from "./taint_mock";

class Child003 {
    @Link()
    title: string = "";

    build(): void {
        taint.Sink(this.title);
    }
}

class Parent003 {
    @State()
    title: string = "safe";

    build(): void {
        const child = new Child003({ title: this.title });
        child.build();
    }
}

export function link_no_taint_003_F(): void {
    const p = new Parent003();
    p.build();
}
