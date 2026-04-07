import { ButtonValue, taint } from "./taint_mock";

class PageIo003 {
    private mirrored = "prefix:";

    build(): void {
        const button = new ButtonValue();
        button.onChange((payload: string) => {
            this.mirrored = this.mirrored + payload;
        });
        taint.Sink(this.mirrored);
    }
}

export function event_env_io_003_T(_taint_src: string): void {
    new PageIo003().build();
}
