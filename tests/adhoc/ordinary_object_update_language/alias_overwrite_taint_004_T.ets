import { taint } from "./taint_mock";

export function alias_overwrite_taint_004_T(taint_src: string): void {
  const obj: any = { seed: "_" };
  const alias = obj;
  obj.seed = "safe";
  alias.seed = taint_src;
  taint.Sink(obj.seed);
}
