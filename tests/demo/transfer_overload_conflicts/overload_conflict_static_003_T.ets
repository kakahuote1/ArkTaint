import { taint } from "./taint_mock";

export function overload_conflict_static_003_T(taint_src: string) {
    const out = taint.ConflictStaticAllowed.BridgeSame(taint_src);
    taint.Sink(out);
}
