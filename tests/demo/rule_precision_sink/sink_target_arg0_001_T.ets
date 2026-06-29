import { taint } from "./taint_mock";

export function sink_target_arg0_001_T() {
    const taint_src = taint.SourceReturn("secret");
    const safe = "safe";
    taint.SinkArg0(taint_src, safe);
}
