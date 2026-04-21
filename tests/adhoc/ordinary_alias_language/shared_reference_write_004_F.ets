import { taint } from "./taint_mock";

export function shared_reference_write_004_F(taint_src: string): void {
  const shared = { seed: "_" };
  const left: any = { slot: shared };
  const right: any = { slot: shared };
  left.slot.seed = "_";
  taint.Sink(right.slot.seed);
  void taint_src;
}
