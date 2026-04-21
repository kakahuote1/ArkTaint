import { taint } from "./taint_mock";

export function deep_field_chain_006_F(taint_src: string): void {
  const leaf = { seed: "_" };
  const middle = { leaf };
  const wrapper = { middle };
  taint.Sink(wrapper.middle.leaf.seed);
  void taint_src;
}
