import { Link, State, taint } from "./taint_mock";

class Child002 {
    @Link()
    title: string = "";

    build(): void {
        taint.Sink(this.title);
    }
}

class Parent002 {
    @State()
    title: string = "";

    build(): void {
        const child = new Child002({ title: this.title });
        child.build();
    }
}

export function link_parent_to_child_002_T(taint_src: string): void {
    const p = new Parent002();
    p.title = taint_src;
    p.build();
}
