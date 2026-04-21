import { taint } from "./taint_mock";

export function sink_target_arg1_004_F(taint_src: string) {
    const safe = "safe";
    taint.SinkArg1(taint_src, safe);
}
