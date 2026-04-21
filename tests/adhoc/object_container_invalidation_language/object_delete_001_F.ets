import { taint } from "./taint_mock";

export function object_delete_001_F(taint_src: string): void {
    const obj: any = { seed: taint_src };
    delete obj.seed;
    taint.Sink(obj.seed);
}
