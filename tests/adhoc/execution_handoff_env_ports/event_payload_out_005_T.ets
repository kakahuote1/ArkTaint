import { ButtonValue, taint } from "./taint_mock";

class PagePayloadOut005 {
    private mirrored = "";

    build(taint_src: ButtonValue): void {
        taint_src.onChange((payload: string) => {
            this.mirrored = payload;
        });
        taint.Sink(this.mirrored);
    }
}

export function event_payload_out_005_T(taint_src: ButtonValue): void {
    new PagePayloadOut005().build(taint_src);
}
