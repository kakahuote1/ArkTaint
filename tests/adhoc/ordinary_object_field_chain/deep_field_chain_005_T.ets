import { taint } from "./taint_mock";

export function deep_field_chain_005_T(taint_src: string): void {
  const leaf = { seed: taint_src };
  const middle = { leaf };
  const wrapper = { middle };
  taint.Sink(wrapper.middle.leaf.seed);
}
