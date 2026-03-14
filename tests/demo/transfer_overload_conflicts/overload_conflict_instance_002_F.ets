import { taint } from "./taint_mock";

export function overload_conflict_instance_002_F(taint_src: string) {
    const host = new taint.ConflictBlocked();
    const out = host.BridgeSame(taint_src);
    taint.Sink(out);
}
