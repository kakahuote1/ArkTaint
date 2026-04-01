import { taint } from "./taint_mock";

export function alias_reassignment_break_006_F(taint_src: string): void {
  const base: any = {};
  let alias = base;
  alias = {};
  alias.seed = taint_src;
  taint.Sink(base.seed);
}
