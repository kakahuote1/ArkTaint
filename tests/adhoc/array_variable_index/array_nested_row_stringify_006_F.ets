import { taint } from "./taint_mock";

export function array_nested_row_stringify_006_F(taint_src: string): void {
  const rows: string[][] = [[]];
  rows[0][0] = JSON.stringify("clean");
  taint.Sink(rows[0]);
  void taint_src;
}
