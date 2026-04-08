import { ButtonValue, taint } from "./taint_mock";

class PagePayloadIo006 {
    private mirrored = "prefix:";

    build(taint_src: ButtonValue): void {
        taint_src.onValue((payload: string) => {
            this.mirrored = this.mirrored + payload;
        });
        taint.Sink(this.mirrored);
    }
}

export function event_payload_io_006_T(taint_src: ButtonValue): void {
    new PagePayloadIo006().build(taint_src);
}
