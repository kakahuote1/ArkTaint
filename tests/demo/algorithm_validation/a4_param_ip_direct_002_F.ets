// Algorithm A - Parameter Layer: IP_direct excludes non-invoked param
// Verifies: `dontInvoke` receives a callback but never calls it.
// IP_direct returns empty → no CALL edge → taint does NOT flow.
import { taint } from "./taint_mock";

function dontInvoke(label: string, cb: (v: string) => void): void {
    console.log(label);
}

export function a4_param_ip_direct_002_F(taint_src: string): void {
    dontInvoke("x", (v: string) => {
        taint.Sink(v);
    });
}
