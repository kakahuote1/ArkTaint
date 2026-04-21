import { taint } from "./taint_mock";

export function transfer_priority_002_T(taint_src: string) {
    const host = new taint.PriorityHostConstrained();
    const out = host.Bridge(taint_src);
    taint.Sink(out);
}
