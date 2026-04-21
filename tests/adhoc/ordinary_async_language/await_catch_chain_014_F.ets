import { taint } from "./taint_mock";

export async function await_catch_chain_014_F(taint_src: string): Promise<void> {
  void taint_src;
  const result = await Promise.reject("safe").catch((reason: string): string => reason);
  taint.Sink(result);
}
