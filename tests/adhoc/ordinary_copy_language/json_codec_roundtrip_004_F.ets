import { JsonCodec } from "./JsonCodec";
import { taint } from "./taint_mock";

export function json_codec_roundtrip_004_F(taint_src: string) {
  const codec = new JsonCodec();
  const unused = { secret: taint_src };
  const payload = { secret: "_" };
  const serialized = codec.stringify(payload);
  const parsed = codec.parse(serialized);
  taint.Sink(parsed.secret);
  void unused;
}
