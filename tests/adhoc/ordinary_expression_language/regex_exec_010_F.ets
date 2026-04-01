import { taint } from "./taint_mock";

export function regex_exec_010_F(taint_src: string) {
  const raw = "id=safe";
  const pattern = /id=(.*)/;
  const matched = pattern.exec(raw);
  if (matched) {
    taint.Sink(matched[1]);
  }
}
