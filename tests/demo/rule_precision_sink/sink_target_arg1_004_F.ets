import { taint } from "./taint_mock";

export function sink_target_arg1_004_F() {
    const taint_src = taint.SourceReturn("secret");
    const safe = "safe";
    taint.SinkArg1(taint_src, safe);
}
