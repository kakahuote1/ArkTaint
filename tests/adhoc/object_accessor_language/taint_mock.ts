export class UIAbility {}

export const taint = {
    Source(): string {
        return "TAINT";
    },
    Sink(_value: any): void {},
};
