import { taint } from "./taint_mock";

class Mix102 {
    static merge(a: string, b: string): string {
        let left = a;
        let right = b;
        left = right;
        return "safe";
    }
}

export function transfer_variant_arg1_to_result_102_T(taint_src: string) {
    let clean = "safe";
    let out = Mix102.merge(clean, taint_src);
    taint.Sink(out);
}

