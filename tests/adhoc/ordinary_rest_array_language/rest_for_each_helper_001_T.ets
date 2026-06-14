import { taint } from "./taint_mock";

function helper(value: string): void {
  taint.Sink(value);
}

function relay(...items: string[]): void {
  let log = "";
  items.forEach((item: string): void => {
    log = log + item;
  });
  helper(log);
}

export function rest_for_each_helper_001_T(taint_src: string): void {
  relay("prefix", taint_src);
}
