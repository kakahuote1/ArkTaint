import { taint } from "./taint_mock";

function registerWithFlag(flag: number, cb: () => void): void {
  if (flag >= 0) {
    setTimeout(cb, 0);
  }
}

export function callback_one_hop_param_002_F(taint_src: string): void {
  const aliasHandler = (): void => {
    taint.Sink("_");
  };
  const safeHandler = (): void => {
    taint.Sink("_");
  };
  // keep another callable in scope to avoid relying on "single callback in file" coincidence
  registerWithFlag(1, aliasHandler);
  registerWithFlag(1, safeHandler);
}
