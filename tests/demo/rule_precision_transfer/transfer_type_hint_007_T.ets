import { taint } from "./taint_mock";

export function transfer_type_hint_007_T(taint_src: string) {
    const host = new taint.TransferTypeHostTarget();
    const out = host.BridgeTypeHint(taint_src);
    taint.Sink(out);
}
