import { taint } from "./taint_mock";

class Box {
  value: string = "_";
  other: string = "_";
}

async function wrap(box: Box): Promise<Box> {
  return Promise.resolve(box);
}

export async function await_field_carrier_006_F(taint_src: string): Promise<void> {
  const box = new Box();
  box.value = taint_src;
  const result = await wrap(box);
  taint.Sink(result.other);
}
