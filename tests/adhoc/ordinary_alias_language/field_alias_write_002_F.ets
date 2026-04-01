import { taint } from "./taint_mock";

export function field_alias_write_002_F(taint_src: string): void {
  const base: any = {};
  const alias = base;
  alias.seed = "_";
  taint.Sink(base.seed);
  void taint_src;
}
