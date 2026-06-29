import { taint } from "./taint_mock";

class EpisodeBox {
  list: string[] = [];
}

export function object_literal_array_property_relay_018_F(taint_src: string): void {
  const episodes: string[] = [];
  episodes.push("clean");

  const box: EpisodeBox = {
    list: episodes,
  };

  taint.Sink(box.list[0]);
  void taint_src;
}
