import { taint } from "./taint_mock";

function runNow(callback: () => void): void {
  callback();
}

export function class_callback_writeback_stringify_011_T(): void {
  let out = "";
  runNow((): void => {
    const taint_src = "secret";
    out = JSON.stringify(taint_src);
  });
  taint.Sink(out);
}

