import { taint } from "./taint_mock";

export function transfer_priority_001_T(taint_src: string) {
    const host = new taint.PriorityHostExact();
    const out = host.Bridge(taint_src);
    taint.Sink(out);
}
