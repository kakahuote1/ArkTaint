import { taint } from "./taint_mock";

class PageIo004 {
    private mirrored = "prefix:";

    build(value: string): void {
        Promise.resolve(value)
            .then(_payload => {
                this.mirrored = this.mirrored + "safe";
            })
            .then(() => {
                taint.Sink(this.mirrored);
            });
    }
}

export function promise_then_env_io_004_F(taint_src: string): void {
    new PageIo004().build(taint_src);
}
