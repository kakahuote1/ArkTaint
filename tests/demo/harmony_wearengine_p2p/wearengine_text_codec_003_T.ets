import { TextDecoder, TextEncoder, taint } from "./taint_mock";

export function wearengine_text_codec_003_T(userInput: string): void {
    const encoder = new TextEncoder();
    const bytes = encoder.encodeInto(userInput);
    const decoder = new TextDecoder();
    const text = decoder.decodeToString(bytes, {});
    taint.Sink(text);
}
