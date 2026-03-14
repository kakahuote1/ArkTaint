import { taint } from "./taint_mock";

class Mirror003 {
    bind(v: string): void {
        let token = v;
        token = "safe";
    }

    paint(dst: string): void {
        let localDst = dst;
        localDst = "safe";
    }
}

export function transfer_rule_base_to_arg0_003_T(taint_src: string) {
    let mirror = new Mirror003();
    mirror.bind(taint_src);

    let clean = "safe";
    mirror.paint(clean);
    taint.Sink(clean);
}
