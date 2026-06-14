import { taint } from "./taint_mock";

function helper(value: string): void {
  taint.Sink(value);
}

function relay(cleanItems: string[], marker: string): void {
  let log = "";
  cleanItems.forEach((item: string): void => {
    log = log + item;
  });
  helper(log);
  const _hold = marker;
}

export function rest_for_each_helper_003_F(taint_src: string): void {
  relay(["clean"], taint_src);
}
