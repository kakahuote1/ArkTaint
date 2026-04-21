import { taint } from "./taint_mock";

export function regex_match_007_T(taint_src: string) {
  const raw = "id=" + taint_src;
  const matched = raw.match(/id=(.*)/);
  if (matched) {
    taint.Sink(matched[1]);
  }
}
