import { taint } from "./taint_mock";

export function sink_arg_count_010_F() {
    const taint_src = taint.SourceReturn("secret");
    taint.SinkArgCount("safe");
    console.log(taint_src);
}
