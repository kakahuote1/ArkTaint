import { taint } from "./taint_mock";

export async function promise_finally_passthrough_011_T(taint_src: string): Promise<void> {
  const result = await Promise.resolve(taint_src).finally((): void => {});
  taint.Sink(result);
}
