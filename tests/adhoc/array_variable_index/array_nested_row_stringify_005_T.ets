import { taint } from "./taint_mock";

export function array_nested_row_stringify_005_T(taint_src: string): void {
  const rows: string[][] = [[]];
  rows[0][0] = JSON.stringify(taint_src);
  taint.Sink(rows[0]);
}
