import { taint } from "./taint_mock";

class Dict002 {
    putPair(k: string, v: string): void {
        let key = k;
        let value = v;
        key = value;
    }

    get(): string {
        return "safe";
    }
}

export function transfer_rule_arg1_002_T(taint_src: string) {
    let dict = new Dict002();
    dict.putPair("token", taint_src);
    let out = dict.get();
    taint.Sink(out);
}
