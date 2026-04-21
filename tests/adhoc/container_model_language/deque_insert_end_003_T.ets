import Deque from "@ohos.util.Deque";
import { taint } from "./taint_mock";

export function deque_insert_end_003_T(taint_src: string): void {
    const d = new Deque<string>();
    d.insertEnd(taint_src);
    d.insertEnd("clean");
    taint.Sink(d.getFirst());
}
