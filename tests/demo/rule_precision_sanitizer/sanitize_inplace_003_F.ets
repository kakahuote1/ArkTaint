import { CleanInPlace, Sink, Source } from "./taint_mock";

function sanitize_inplace_003_F(taint_src: any): void {
    Source(taint_src);
    CleanInPlace(taint_src);
    Sink(taint_src);
}

sanitize_inplace_003_F("taint");
