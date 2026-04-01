import { JsonCodec } from "./JsonCodec";
import { taint } from "./taint_mock";

export function json_codec_roundtrip_003_T(taint_src: string) {
  const codec = new JsonCodec();
  const payload = { secret: taint_src };
  const serialized = codec.stringify(payload);
  const parsed = codec.parse(serialized);
  taint.Sink(parsed.secret);
}
