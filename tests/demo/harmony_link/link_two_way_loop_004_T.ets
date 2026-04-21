import { Link, State, taint } from "./taint_mock";

class Child004 {
    @Link()
    title: string = "";

    write(v: string): void {
        this.title = v;
    }
}

class Parent004 {
    @State()
    title: string = "safe";

    build(taint_src: string): void {
        const c = new Child004({ title: this.title });
        c.write(taint_src);
        taint.Sink(this.title);
    }
}

export function link_two_way_loop_004_T(taint_src: string): void {
    const p = new Parent004();
    p.build(taint_src);
}

