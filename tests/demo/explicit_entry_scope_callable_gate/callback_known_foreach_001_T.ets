import { taint } from "./taint_mock";

export function callback_known_foreach_001_T(taint_src: string) {
  [taint_src].forEach(item => {
    taint.Sink(item);
  });
}
