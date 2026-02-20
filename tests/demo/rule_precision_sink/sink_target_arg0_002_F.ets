import { taint } from "./taint_mock";

export function sink_target_arg0_002_F(taint_src: string) {
    const safe = "safe";
    taint.SinkArg0(safe, taint_src);
}
