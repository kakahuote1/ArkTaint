import { taint } from "./taint_mock";

class Other107 {
    push(v: string): void {
        let t = v;
        t = "safe";
    }

    pull(): string {
        return "safe";
    }
}

export function transfer_variant_no_rule_107_F(taint_src: string) {
    let o = new Other107();
    o.push(taint_src);
    let out = o.pull();
    taint.Sink(out);
}

