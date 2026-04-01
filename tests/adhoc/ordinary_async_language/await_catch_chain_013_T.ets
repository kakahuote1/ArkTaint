import { taint } from "./taint_mock";

export async function await_catch_chain_013_T(taint_src: string): Promise<void> {
  const result = await Promise.reject(taint_src).catch((reason: string): string => reason);
  taint.Sink(result);
}
