import { Search, cbOnSubmit } from "./taint_mock";

class EventPage013 {
    build(): void {
        const search = new Search();
        search.onSubmit(cbOnSubmit);
    }
}

export function event_search_onsubmit_build_013_T(): void {
    const page = new EventPage013();
    page.build();
}
