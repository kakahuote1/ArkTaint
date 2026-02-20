import { taint } from "./taint_mock";

export function overload_conflict_instance_001_T(taint_src: string) {
    const host = new taint.ConflictAllowed();
    const out = host.BridgeSame(taint_src);
    taint.Sink(out);
}
