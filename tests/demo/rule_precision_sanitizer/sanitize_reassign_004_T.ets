import { Escape, Sink } from "./taint_mock";

function sanitize_reassign_004_T(taint_src: any): void {
    let clean = Escape(taint_src);
    clean = taint_src;
    Sink(clean);
}

sanitize_reassign_004_T("taint");

