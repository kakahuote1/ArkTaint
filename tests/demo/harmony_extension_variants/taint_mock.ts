export namespace taint {
    export function Source(): string {
        return "ime-source";
    }

    export function Sink(value: any): void {
        void value;
    }
}

export class Want {
    payload: any;

    constructor(payload: any) {
        this.payload = payload;
    }
}

export class InputMethodExtensionAbility {
    onCreate(): void {}
    onDestroy(): void {}
}

export class WorkSchedulerExtensionAbility {
    onWorkStart(workInfo: any): void {
        void workInfo;
    }

    onWorkStop(workInfo: any): void {
        void workInfo;
    }
}
