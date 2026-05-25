import { taint } from "./taint_mock";

class EventPage010 {
    build(): void {
        TextInput({ placeholder: "name" })
            .onChange((value: string): void => {
                taint.Sink(value);
            });
    }
}

export function event_onchange_dsl_build_010_T(): void {
    const page = new EventPage010();
    page.build();
}
