import { taint } from "./taint_mock";

abstract class Reader {
  abstract read(v: string): string;
}

class LeakReader extends Reader {
  read(v: string): string {
    return v;
  }
}

class CleanReader extends Reader {
  read(_v: string): string {
    return "_";
  }
}

function makeLeakReader(): Reader {
  return new LeakReader();
}

export function helper_return_base_005_T(taint_src: string) {
  const reader = makeLeakReader();
  taint.Sink(reader.read(taint_src));
}
