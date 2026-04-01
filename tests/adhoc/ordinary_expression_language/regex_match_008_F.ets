import { taint } from "./taint_mock";

export function regex_match_008_F(taint_src: string) {
  const raw = "id=safe";
  const matched = raw.match(/id=(.*)/);
  if (matched) {
    taint.Sink(matched[1]);
  }
}
