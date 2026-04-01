import { taint } from "./taint_mock";

interface Reader {
  read(v: string): string;
}

class LeakReader implements Reader {
  read(v: string): string {
    return v;
  }
}

class Box {
  reader: Reader;

  constructor(reader: Reader) {
    this.reader = reader;
  }

  run(v: string): string {
    return this.reader.read(v);
  }
}

export function field_carried_interface_007_T(taint_src: string) {
  const box = new Box(new LeakReader());
  taint.Sink(box.run(taint_src));
}
