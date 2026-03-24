export namespace taint {
    export function Source(): string {
        return "tainted_handoff_source";
    }

    export function Sink(v: any): void {
        void v;
    }
}

export class Want {
    payload: any;

    constructor(payload?: any) {
        this.payload = payload;
    }
}

export class AbilityContext {
    startAbility(_want: Want): void {}
    startAbilityForResult(_want: Want): void {}
    connectServiceExtensionAbility(_want: Want): void {}
}

export class ServiceExtensionAbility {
    context: AbilityContext = new AbilityContext();
}

export class UIAbility {
    context: AbilityContext = new AbilityContext();
}

