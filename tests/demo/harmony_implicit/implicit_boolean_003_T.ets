import { taint } from "./taint_mock";

export function implicit_boolean_003_T(taint_src: string): void {
    const ok = taint_src.length > 3 ? true : false;
    taint.Sink(ok);
}
