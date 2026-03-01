import { taint } from "./taint_mock";

export function implicit_constant_004_F(): void {
    const ok = true;
    taint.Sink(ok);
}
