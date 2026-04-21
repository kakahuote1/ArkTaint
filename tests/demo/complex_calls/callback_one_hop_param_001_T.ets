import { taint } from "./taint_mock";

function registerWithFlag(flag: number, cb: () => void): void {
  if (flag > 0) {
    setTimeout(cb, 0);
  }
}

export function callback_one_hop_param_001_T(taint_src: string): void {
  const taintedHandler = (): void => {
    taint.Sink(taint_src);
  };
  const safeHandler = (): void => {
    taint.Sink("_");
  };
  registerWithFlag(1, taintedHandler);
  registerWithFlag(0, safeHandler);
}

