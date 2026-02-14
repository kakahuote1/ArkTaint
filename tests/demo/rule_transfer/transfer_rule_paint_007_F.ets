import { taint } from "./taint_mock";

class Mirror007 {
    bind(v: string): void {
        let token = v;
        token = "safe";
    }

    paint(dst: string): void {
        let localDst = dst;
        localDst = "safe";
    }
}

export function transfer_rule_paint_007_F(taint_src: string) {
    let mirror = new Mirror007();
    mirror.bind("clean");

    let clean = "safe";
    mirror.paint(clean);
    taint.Sink(clean);
}
