import { taint } from "./taint_mock";

export function transfer_type_hint_008_F(taint_src: string) {
    const host = new taint.TransferTypeHostOther();
    const out = host.BridgeTypeHint(taint_src);
    taint.Sink(out);
}
