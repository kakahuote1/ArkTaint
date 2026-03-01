import { Link, State, taint } from "./taint_mock";

class Child001 {
    @Link()
    title: string = "";

    update(v: string): void {
        this.title = v;
    }
}

class Parent001 {
    @State()
    title: string = "safe";

    build(taint_src: string): void {
        const child = new Child001({ title: this.title });
        child.update(taint_src);
        taint.Sink(this.title);
    }
}

export function link_child_update_parent_001_T(taint_src: string): void {
    const p = new Parent001();
    p.build(taint_src);
}
