import { taint } from "./taint_mock";

async function wrap(value: string): Promise<string> {
  return Promise.resolve(value);
}

export async function await_resolve_local_003_T(taint_src: string): Promise<void> {
  const pending = wrap(taint_src);
  const result = await pending;
  taint.Sink(result);
}
