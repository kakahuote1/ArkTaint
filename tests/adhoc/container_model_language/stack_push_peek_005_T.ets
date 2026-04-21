import Stack from "@ohos.util.Stack";
import { taint } from "./taint_mock";

export function stack_push_peek_005_T(taint_src: string): void {
    const s = new Stack<string>();
    s.push("clean");
    s.push(taint_src);
    taint.Sink(s.peek());
}
