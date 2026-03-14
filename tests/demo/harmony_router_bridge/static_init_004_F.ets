import { taint } from "./taint_mock";

class StaticHolder004 {
    static SHARED: string = "safe_static_literal";
}

export function static_init_004_F(): void {
    taint.Sink(StaticHolder004.SHARED);
}
