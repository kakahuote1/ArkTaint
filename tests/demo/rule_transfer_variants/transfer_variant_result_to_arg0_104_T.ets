import { taint } from "./taint_mock";

class Relay104 {
    static relay(seed: string): string {
        let local = seed;
        local = "safe";
        return "safe";
    }
}

export function transfer_variant_result_to_arg0_104_T(taint_src: string) {
    let clean = "safe";
    let out = Relay104.relay(clean);
    out = taint_src;
    taint.Sink(clean);
}

