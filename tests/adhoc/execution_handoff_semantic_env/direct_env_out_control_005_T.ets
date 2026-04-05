import { taint } from "./taint_mock";

function invokeNow(callback: (value: string) => void, value: string): void {
    callback(value);
}

class PageOutControl005 {
    private mirrored = "";

    build(value: string): void {
        invokeNow(payload => {
            this.mirrored = payload;
        }, value);
        taint.Sink(this.mirrored);
    }
}

export function direct_env_out_control_005_T(taint_src: string): void {
    new PageOutControl005().build(taint_src);
}
