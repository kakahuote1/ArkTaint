export const taint = {
    Source(): string {
        return "extension-taint";
    },
    Sink(value: any): void {
        void value;
    },
};

export class InputMethodExtensionAbility {}

export class WorkSchedulerExtensionAbility {}

export function sinkHelper(value: any): void {
    taint.Sink(value);
}
