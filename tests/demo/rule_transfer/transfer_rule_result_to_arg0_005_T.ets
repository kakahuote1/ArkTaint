import { taint } from "./taint_mock";

class Relay005 {
    static project(seed: string): string {
        let tmp = seed;
        tmp = "safe";
        return "safe";
    }
}

export function transfer_rule_result_to_arg0_005_T(taint_src: string) {
    let clean = "safe";
    let out = Relay005.project(clean);
    out = taint_src;
    taint.Sink(clean);
}
