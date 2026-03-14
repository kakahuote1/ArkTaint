import { Escape, Sink } from "./taint_mock";

function sanitize_result_002_T(taint_src: any): void {
    const clean = Escape(taint_src);
    Sink(taint_src);
}

sanitize_result_002_T("taint");

