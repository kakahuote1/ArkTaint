import { taint } from "./taint_mock";

export function shared_reference_rebind_007_T(taint_src: string): void {
  const shared = { seed: "_" };
  const left: any = { slot: shared };
  const right: any = { slot: shared };
  const alias = left.slot;
  alias.seed = taint_src;
  taint.Sink(right.slot.seed);
}
