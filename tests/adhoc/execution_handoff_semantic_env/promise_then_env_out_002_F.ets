import { taint } from "./taint_mock";

class PageOut002 {
    private mirrored = "";

    build(value: string): void {
        Promise.resolve(value)
            .then(_payload => {
                this.mirrored = "safe";
            })
            .then(() => {
                taint.Sink(this.mirrored);
            });
    }
}

export function promise_then_env_out_002_F(taint_src: string): void {
    new PageOut002().build(taint_src);
}
