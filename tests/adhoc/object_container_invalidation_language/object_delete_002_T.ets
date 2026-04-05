import { taint } from "./taint_mock";

export function object_delete_002_T(taint_src: string): void {
    const obj: any = { seed: taint_src, keep: "safe" };
    delete obj.keep;
    taint.Sink(obj.seed);
}
