import { writeShared } from "./store";
import { taint } from "./taint_mock";

export function taintmain_context_pollute_seed_001_T(taint_src: string): void {
    writeShared(taint_src);
    taint.Sink(taint_src);
}
