import { taint } from "./taint_mock";

function accept(_cb: () => void): void {}

export function callback_unknown_helper_002_F(taint_src: string) {
  accept(() => {
    taint.Sink(taint_src);
  });
}
