import { ArrayList, taint } from "./taint_mock";

export function list_clear_008_T(taint_src: string): void {
    const xs = new ArrayList<string>();
    xs.add("safe");
    xs.clear();
    xs.add(taint_src);
    taint.Sink(xs.get(0));
}
