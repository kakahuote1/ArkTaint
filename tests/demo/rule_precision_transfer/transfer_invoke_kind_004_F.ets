import { taint } from "./taint_mock";

export function transfer_invoke_kind_004_F(taint_src: string) {
    const out = taint.BridgeInvokeKind(taint_src);
    taint.Sink(out);
}
