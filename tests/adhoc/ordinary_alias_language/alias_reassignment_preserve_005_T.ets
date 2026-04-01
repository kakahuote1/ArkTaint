import { taint } from "./taint_mock";

export function alias_reassignment_preserve_005_T(taint_src: string): void {
  const base: any = {};
  let alias = base;
  const through = alias;
  through.seed = taint_src;
  taint.Sink(base.seed);
}
