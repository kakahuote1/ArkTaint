import { taint } from "./taint_mock";

function invokeNow(callback: (value: string) => void, value: string): void {
    callback(value);
}

class PageOutControl006 {
    private mirrored = "";

    build(value: string): void {
        invokeNow(_payload => {
            this.mirrored = "safe";
        }, value);
        taint.Sink(this.mirrored);
    }
}

export function direct_env_out_control_006_F(taint_src: string): void {
    new PageOutControl006().build(taint_src);
}
