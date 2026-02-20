import { taint } from "./taint_mock";

export function sink_arg_count_009_T(taint_src: string) {
    taint.SinkArgCount(taint_src, "safe");
}
