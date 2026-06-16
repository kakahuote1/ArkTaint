export class taint {
    static Source(): string {
        return "fixture-source";
    }

    static Clean(): string {
        return "fixture-clean";
    }

    static Sink(_value: string): void {
        // sink marker for tests
    }
}

export class UIAbility {
}
