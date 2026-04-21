import HashSet from "@ohos.util.HashSet";
import { taint } from "./taint_mock";

export function hashset_values_012_F(taint_src: string): void {
    const s = new HashSet<string>();
    s.add("clean");
    taint.Sink(s.values());
}
