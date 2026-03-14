import { taint } from "./taint_mock";

export function overload_conflict_arity_006_F(taint_src: string) {
    const out = taint.ConflictArity.BridgeArity(taint_src);
    taint.Sink(out);
}
