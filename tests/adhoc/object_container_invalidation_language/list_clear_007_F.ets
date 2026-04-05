import { ArrayList, taint } from "./taint_mock";

export function list_clear_007_F(taint_src: string): void {
    const xs = new ArrayList<string>();
    xs.add(taint_src);
    xs.clear();
    taint.Sink(xs.get(0));
}
