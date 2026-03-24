// Algorithm A - Expression Layer: Project function resolved via CG
// Verifies: CG(e) correctly resolves project-defined callee `relay`,
// and taint propagates through callback parameter into sink.
import { taint } from "./taint_mock";

function relay(cb: () => void): void {
    cb();
}

export function a1_expr_project_cg_001_T(taint_src: string): void {
    relay(() => {
        taint.Sink(taint_src);
    });
}
