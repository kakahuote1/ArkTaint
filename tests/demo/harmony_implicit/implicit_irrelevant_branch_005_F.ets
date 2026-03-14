import { taint } from "./taint_mock";

export function implicit_irrelevant_branch_005_F(taint_src: string): void {
    const _u = taint_src;
    let out = 1;
    if (1 > 0) {
        out = 2;
    }
    taint.Sink(out);
}
