import { taint } from "./taint_mock";

class EpisodeBox {
  list: string[] = [];
}

export function object_literal_array_property_relay_017_T(taint_src: string): void {
  const episodes: string[] = [];
  episodes.push(taint_src);

  const box: EpisodeBox = {
    list: episodes,
  };

  taint.Sink(box.list[0]);
}
