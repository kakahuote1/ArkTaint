import { Escape, Sink, Source } from "./taint_mock";

function sanitize_result_001_F(taint_src: any): void {
    Source(taint_src);
    const clean = Escape(taint_src);
    Sink(clean);
}

sanitize_result_001_F("taint");
