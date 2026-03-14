import { taint } from "./taint_mock";

export function transfer_priority_003_T(taint_src: string) {
    const host = new taint.PriorityHostFuzzy();
    const out = host.Bridge(taint_src);
    taint.Sink(out);
}
