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

function makeCleanReader(): Reader {
  return new CleanReader();
}

export function helper_return_base_006_F(taint_src: string) {
  const reader = makeCleanReader();
  taint.Sink(reader.read(taint_src));
}
