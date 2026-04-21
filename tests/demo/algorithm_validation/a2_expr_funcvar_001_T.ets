// Algorithm A - Expression Layer: Function-type variable call (resolve(e))
// Verifies: When callee is a local variable holding a function reference,
// resolve(e) traces the assignment chain and resolves the actual callee.
import { taint } from "./taint_mock";

function doSink(data: string): void {
    taint.Sink(data);
}

export function a2_expr_funcvar_001_T(taint_src: string): void {
    let fn = doSink;
    fn(taint_src);
}
