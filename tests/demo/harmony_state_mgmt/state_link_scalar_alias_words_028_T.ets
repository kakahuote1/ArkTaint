import { Prop, State, taint } from "./taint_mock";

class SearchListViewModel028 {
    searchAsync(words: string): void {
        taint.Sink(words);
    }
}

class SearchListComponent028 {
    @Prop()
    searchWords: string = "";

    private viewModel: SearchListViewModel028 = new SearchListViewModel028();

    build(): void {
        this.viewModel.searchAsync(this.searchWords);
    }
}

class SearchPage028 {
    @State()
    words: string = "";

    onInputChange(words: string): void {
        this.words = words;
    }

    build(): void {
        const child = new SearchListComponent028({ searchWords: this.words });
        child.build();
    }
}

export function state_link_scalar_alias_words_028_T(taint_src: string): void {
    const page = new SearchPage028();
    page.onInputChange(taint_src);
    page.build();
}
