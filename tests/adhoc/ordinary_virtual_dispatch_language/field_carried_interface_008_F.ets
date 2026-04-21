import { taint } from "./taint_mock";

interface Reader {
  read(v: string): string;
}

class CleanReader implements Reader {
  read(_v: string): string {
    return "_";
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

export function field_carried_interface_008_F(taint_src: string) {
  const box = new Box(new CleanReader());
  taint.Sink(box.run(taint_src));
}
