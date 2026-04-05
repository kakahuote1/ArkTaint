import { Queue, taint } from "./taint_mock";

export function queue_clear_009_F(taint_src: string): void {
    const q = new Queue<string>();
    q.add(taint_src);
    q.clear();
    taint.Sink(q.getFirst());
}
