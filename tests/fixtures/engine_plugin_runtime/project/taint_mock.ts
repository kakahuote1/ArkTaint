export class taint {
    static Source(): string {
        return "fixture-source";
    }

    static Sink(_value: string): void {
        // sink marker for tests
    }
}
