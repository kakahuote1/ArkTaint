import { taint } from "./taint_mock";

export function async_alias_chain_001_T(taint_src: string): void {
  const handler = (): void => {
    taint.Sink(taint_src);
  };
  const cb = handler;
  setTimeout(cb, 0);
}

