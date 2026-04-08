import { ButtonValue, taint } from "./taint_mock";

class PageOut002 {
    private mirrored = "";

    build(): void {
        const button = new ButtonValue();
        button.onValue((payload: string) => {
            this.mirrored = payload;
        });
        taint.Sink(this.mirrored);
    }
}

export function event_env_out_002_T(_taint_src: string): void {
    new PageOut002().build();
}
