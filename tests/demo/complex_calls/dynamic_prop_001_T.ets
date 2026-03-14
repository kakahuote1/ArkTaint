import { taint } from "./taint_mock";

function callByKey(target: any, key: string, value: string): void {
  target[key](value);
}

export function dynamic_prop_001_T(taint_src: string): void {
  const handlers = {
    onData: (x: string): void => {
      taint.Sink(x);
    },
  };
  const methodName = "onData";
  callByKey(handlers, methodName, taint_src);
}

