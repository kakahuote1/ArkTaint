import { taint } from "./taint_mock";

export function transfer_ptr_signature_001_T(taint_src: string): void {
    const bridge = taint.BridgePtr;
    const out = bridge(taint_src);
    taint.Sink(out);
}
