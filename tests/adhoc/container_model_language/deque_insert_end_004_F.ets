import Deque from "@ohos.util.Deque";
import { taint } from "./taint_mock";

export function deque_insert_end_004_F(taint_src: string): void {
    const d = new Deque<string>();
    d.insertEnd("clean");
    d.insertEnd(taint_src);
    taint.Sink(d.getFirst());
}
