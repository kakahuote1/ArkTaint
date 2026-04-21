import { taint } from "./taint_mock";

export function async_alias_chain_002_F(taint_src: string): void {
  const handler = (): void => {
    taint.Sink("_");
  };
  const cb = handler;
  setTimeout(cb, 0);
}

