import { taint } from "./taint_mock";

export function sink_invoke_kind_008_F() {
    const taint_src = taint.SourceReturn("secret");
    taint.SinkInvokeKind(taint_src);
}
