// Algorithm A - Expression Layer: Function-type variable, but callee is clean
// Verifies: resolve(e) correctly identifies the callee, but since callee
// doesn't propagate to a sink, no taint flow is reported.
import { taint } from "./taint_mock";

function safeFn(data: string): void {
    console.log("safe: " + data);
}

export function a2_expr_funcvar_002_F(taint_src: string): void {
    let fn = safeFn;
    fn(taint_src);
    taint.Sink("clean");
}
