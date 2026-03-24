// Algorithm A - CALL/RETURN Edges: Function-type variable with return value
// Verifies: Synthetic CALL edge propagates taint into resolved callee param,
// and synthetic RETURN edge brings tainted return value back to caller.
import { taint } from "./taint_mock";

function identity(data: string): string {
    return data;
}

export function a7_call_return_edge_001_T(taint_src: string): void {
    let fn = identity;
    const result = fn(taint_src);
    taint.Sink(result);
}
