import { taint } from "./taint_mock";

export function shared_reference_write_003_T(taint_src: string): void {
  const shared = { seed: "_" };
  const left: any = { slot: shared };
  const right: any = { slot: shared };
  left.slot.seed = taint_src;
  taint.Sink(right.slot.seed);
}
