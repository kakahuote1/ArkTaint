import { Escape, Sink } from "./taint_mock";

function sanitize_result_001_F(taint_src: any): void {
    const clean = Escape(taint_src);
    Sink(clean);
}

sanitize_result_001_F("taint");

