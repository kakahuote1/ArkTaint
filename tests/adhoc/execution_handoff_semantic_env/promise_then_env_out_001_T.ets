import { taint } from "./taint_mock";

class PageOut001 {
    private mirrored = "";

    build(value: string): void {
        Promise.resolve(value)
            .then(payload => {
                this.mirrored = payload;
            })
            .then(() => {
                taint.Sink(this.mirrored);
            });
    }
}

export function promise_then_env_out_001_T(taint_src: string): void {
    new PageOut001().build(taint_src);
}
