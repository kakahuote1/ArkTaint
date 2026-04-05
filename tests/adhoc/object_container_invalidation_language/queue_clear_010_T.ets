import { Queue, taint } from "./taint_mock";

export function queue_clear_010_T(taint_src: string): void {
    const q = new Queue<string>();
    q.add("safe");
    q.clear();
    q.add(taint_src);
    taint.Sink(q.getFirst());
}
