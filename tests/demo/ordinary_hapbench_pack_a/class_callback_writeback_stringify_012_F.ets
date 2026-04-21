import { taint } from "./taint_mock";

function runNow(callback: () => void): void {
  callback();
}

export function class_callback_writeback_stringify_012_F(): void {
  let out = "";
  runNow((): void => {
    const safe = "public";
    out = JSON.stringify(safe);
  });
  taint.Sink("safe");
}

