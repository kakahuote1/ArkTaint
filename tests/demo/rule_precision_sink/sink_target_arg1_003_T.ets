import { taint } from "./taint_mock";

export function sink_target_arg1_003_T(taint_src: string) {
    const safe = "safe";
    taint.SinkArg1(safe, taint_src);
}
