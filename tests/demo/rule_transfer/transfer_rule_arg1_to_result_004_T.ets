import { taint } from "./taint_mock";

class Mixer004 {
    static blend(a: string, b: string): string {
        let left = a;
        let right = b;
        right = left;
        return left;
    }
}

export function transfer_rule_arg1_to_result_004_T(taint_src: string) {
    let clean = "safe";
    let out = Mixer004.blend(clean, taint_src);
    taint.Sink(out);
}
