import { taint } from "./taint_mock";

export function regex_exec_009_T(taint_src: string) {
  const raw = "id=" + taint_src;
  const pattern = /id=(.*)/;
  const matched = pattern.exec(raw);
  if (matched) {
    taint.Sink(matched[1]);
  }
}
