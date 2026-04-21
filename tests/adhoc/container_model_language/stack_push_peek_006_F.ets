import Stack from "@ohos.util.Stack";
import { taint } from "./taint_mock";

export function stack_push_peek_006_F(taint_src: string): void {
    const s = new Stack<string>();
    s.push("clean");
    s.push("clean2");
    taint.Sink(s.peek());
}
