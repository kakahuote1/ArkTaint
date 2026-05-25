import { taint } from "./taint_mock";

interface HandlerBag {
  handle: (value: string) => void;
}

function makeBag(): HandlerBag {
  const relay = (value: string): void => {
    taint.Sink(value);
  };
  const bag: HandlerBag = {
    handle: relay,
  };
  return bag;
}

function install(bag: HandlerBag, value: string): void {
  const callback = (): void => {
    bag.handle(value);
  };
  callback();
}

export function returned_object_field_callable_017_T(taint_src: string): void {
  const bag = makeBag();
  install(bag, taint_src);
}
