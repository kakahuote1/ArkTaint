// Algorithm A - Parameter Layer: IP_direct identifies invoked param
// Verifies: In project function `invokeSecond`, param at index 1 (cb) is
// directly invoked, so CALL edge is built and taint flows through.
import { taint } from "./taint_mock";

function invokeSecond(label: string, cb: (v: string) => void, data: string): void {
    cb(data);
}

export function a4_param_ip_direct_001_T(taint_src: string): void {
    invokeSecond("tag", (v: string) => {
        taint.Sink(v);
    }, taint_src);
}
