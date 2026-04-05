import HashSet from "@ohos.util.HashSet";
import { taint } from "./taint_mock";

export function hashset_values_011_T(taint_src: string): void {
    const s = new HashSet<string>();
    s.add(taint_src);
    taint.Sink(s.values());
}
