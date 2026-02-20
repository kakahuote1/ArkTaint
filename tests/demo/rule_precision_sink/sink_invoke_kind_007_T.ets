import { taint } from "./taint_mock";

export function sink_invoke_kind_007_T(taint_src: string) {
    const host = new taint.InvokeKindHost();
    host.SinkInvokeKind(taint_src);
}
