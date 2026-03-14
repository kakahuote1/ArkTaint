import { taint } from "./taint_mock";

export function implicit_switch_002_T(taint_src: string): void {
    let out = "safe";
    switch (taint_src.length) {
        case 0:
            out = "zero";
            break;
        default:
            out = "nonzero";
            break;
    }
    taint.Sink(out);
}
