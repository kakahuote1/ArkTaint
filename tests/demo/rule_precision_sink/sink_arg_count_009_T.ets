import { taint } from "./taint_mock";

export function sink_arg_count_009_T() {
    const taint_src = taint.SourceReturn("secret");
    taint.SinkArgCount(taint_src, "safe");
}
