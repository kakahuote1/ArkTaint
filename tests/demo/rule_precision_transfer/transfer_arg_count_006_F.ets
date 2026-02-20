import { taint } from "./taint_mock";

export function transfer_arg_count_006_F(taint_src: string) {
    const out = taint.BridgeArgCount(taint_src);
    taint.Sink(out);
}
