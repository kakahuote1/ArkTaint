import { taint } from "./taint_mock";

export function implicit_if_flag_001_T(taint_src: string): void {
    let flag = 0;
    if (taint_src.length > 0) {
        flag = 1;
    } else {
        flag = 2;
    }
    taint.Sink(flag);
}
