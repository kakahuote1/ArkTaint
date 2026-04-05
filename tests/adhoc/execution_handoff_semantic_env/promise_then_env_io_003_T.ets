import { taint } from "./taint_mock";

class PageIo003 {
    private mirrored = "prefix:";

    build(value: string): void {
        Promise.resolve(value)
            .then(payload => {
                this.mirrored = this.mirrored + payload;
            })
            .then(() => {
                taint.Sink(this.mirrored);
            });
    }
}

export function promise_then_env_io_003_T(taint_src: string): void {
    new PageIo003().build(taint_src);
}
