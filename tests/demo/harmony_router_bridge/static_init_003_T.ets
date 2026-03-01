import { taint } from "./taint_mock";

class StaticHolder003 {
    static SHARED: string = taint.Source();
}

export function static_init_003_T(): void {
    taint.Sink(StaticHolder003.SHARED);
}
