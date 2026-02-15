import { taint } from "./taint_mock";

class Holder {
  value: string;

  constructor(v: string) {
    this.value = v;
  }

  makeSink(): () => void {
    return () => {
      taint.Sink(this.value);
    };
  }
}

export function arrow_this_002_F(taint_src: string) {
  let h = new Holder("_");
  let f = h.makeSink();
  f();
}
