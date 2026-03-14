import { taint } from "./taint_mock";

export function transfer_invoke_kind_003_T(taint_src: string) {
    const host = new taint.InvokeKindHost();
    const out = host.BridgeInvokeKind(taint_src);
    taint.Sink(out);
}
