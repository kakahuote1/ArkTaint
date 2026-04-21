import { taint } from "./taint_mock";

export function transfer_ptr_signature_002_F(taint_src: string): void {
    const bridge = taint.SafePtr;
    const out = bridge(taint_src);
    taint.Sink(out);
}
