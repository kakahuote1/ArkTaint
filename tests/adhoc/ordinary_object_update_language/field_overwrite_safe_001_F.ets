import { taint } from "./taint_mock";

export function field_overwrite_safe_001_F(taint_src: string): void {
  const obj: any = { seed: "_" };
  obj.seed = taint_src;
  obj.seed = "safe";
  taint.Sink(obj.seed);
}
