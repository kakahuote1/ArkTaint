import { taint } from "./taint_mock";

export function sink_target_arg0_002_F() {
    const taint_src = taint.SourceReturn("secret");
    const safe = "safe";
    taint.SinkArg0(safe, taint_src);
}
