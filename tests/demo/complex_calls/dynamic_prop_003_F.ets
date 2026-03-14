import { taint } from "./taint_mock";

function callByKey(target: any, key: string, value: string): void {
  target[key](value);
}

export function dynamic_prop_003_F(taint_src: string): void {
  const handlers = {
    onData: (x: string): void => {
      taint.Sink(x);
    },
    onSafe: (_x: string): void => {
      console.log("safe branch");
    },
  };
  callByKey(handlers, "onSafe", taint_src);
}
