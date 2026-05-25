import { taint } from "./taint_mock";

export function sink_multi_endpoint_013_T() {
    const taint_src = taint.SourceReturn("secret");
    taint.SinkMulti(taint_src, taint_src);
}
