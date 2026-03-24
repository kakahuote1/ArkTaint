// Algorithm A - Expression Layer: Project function resolved via CG, but callback not invoked
// Verifies: IP_direct correctly excludes param index 1 (cb is never invoked),
// so taint should NOT reach the sink.
import { taint } from "./taint_mock";

function storeOnly(label: string, cb: () => void): void {
    console.log(label);
}

export function a1_expr_project_cg_002_F(taint_src: string): void {
    storeOnly("x", () => {
        taint.Sink(taint_src);
    });
}
