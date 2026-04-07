import { ButtonValue, taint } from "./taint_mock";

export function event_env_in_001_T(taint_src: string): void {
    const button = new ButtonValue();
    button.onChange((_payload: string) => {
        taint.Sink(taint_src);
    });
}
