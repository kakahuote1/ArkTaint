import { taint } from "./taint_mock";

export function overload_conflict_arity_005_T(taint_src: string) {
    const out = taint.ConflictArity.BridgeArity("safe", taint_src);
    taint.Sink(out);
}
