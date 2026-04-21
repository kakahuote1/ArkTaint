import { taint } from "./taint_mock";

export function field_overwrite_taint_002_T(taint_src: string): void {
  const obj: any = { seed: "_" };
  obj.seed = "safe";
  obj.seed = taint_src;
  taint.Sink(obj.seed);
}
