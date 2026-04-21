export const taint = {
    Source(): string {
        return "want-taint";
    },
    Sink(value: any): void {
        void value;
    },
};

export class Want {
    token: any;

    constructor(token: any) {
        this.token = token;
    }
}

export class AbilityContext {
    startAbility(want: Want): void {
        void want;
    }

    startAbilityForResult(want: Want): void {
        void want;
    }
}

export class UIAbility {
    context: AbilityContext = new AbilityContext();
}
