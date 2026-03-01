import { taint } from "./taint_mock";

function callByKey(target: any, key: string, value: string): void {
  target[key](value);
}

export function dynamic_prop_002_F(taint_src: string): void {
  const handlers = {
    onData: (_x: string): void => {
      taint.Sink("_");
    },
  };
  const methodName = "onData";
  callByKey(handlers, methodName, taint_src);
}

