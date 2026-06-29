import { taint } from "./taint_mock";

export function sink_invoke_kind_007_T() {
    const taint_src = taint.SourceReturn("secret");
    const host = new taint.InvokeKindHost();
    host.SinkInvokeKind(taint_src);
}
