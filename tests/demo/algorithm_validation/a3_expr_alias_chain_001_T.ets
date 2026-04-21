// Algorithm A - Expression Layer: Multi-hop alias chain for function reference
// Verifies: resolve(e) follows alias chain: fn1 → fn2 → fn3 → doSink
import { taint } from "./taint_mock";

function doSink(data: string): void {
    taint.Sink(data);
}

export function a3_expr_alias_chain_001_T(taint_src: string): void {
    const fn1 = doSink;
    const fn2 = fn1;
    const fn3 = fn2;
    fn3(taint_src);
}
