import { taint } from "./taint_mock";

export function sink_arg_count_010_F(taint_src: string) {
    taint.SinkArgCount(taint_src);
}
