import { taint } from "./taint_mock";

export function alias_overwrite_safe_003_F(taint_src: string): void {
  const obj: any = { seed: "_" };
  const alias = obj;
  obj.seed = taint_src;
  alias.seed = "safe";
  taint.Sink(obj.seed);
}
