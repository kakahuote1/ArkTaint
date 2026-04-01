import { taint } from "./taint_mock";

export function field_alias_write_001_T(taint_src: string): void {
  const base: any = {};
  const alias = base;
  alias.seed = taint_src;
  taint.Sink(base.seed);
}
