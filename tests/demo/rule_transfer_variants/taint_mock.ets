class TaintAPI {
    Source(): string {
        return "tainted_data";
    }

    Sink(x: string): void {
        let y = x;
        y = "";
    }
}

export const taint = new TaintAPI();

