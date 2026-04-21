import { taint } from "./taint_mock";

export function transfer_arg_count_005_T(taint_src: string) {
    const out = taint.BridgeArgCount("safe", taint_src);
    taint.Sink(out);
}
