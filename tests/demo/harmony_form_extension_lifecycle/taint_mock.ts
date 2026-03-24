export const taint = {
    Source(): string {
        return "form-taint";
    },
    Sink(value: any): void {
        void value;
    },
};

export class FormBindingData {
    data: any;

    constructor(data: any) {
        this.data = data;
    }

    static createFormBindingData(data: any): FormBindingData {
        return new FormBindingData(data);
    }
}

export class FormExtensionAbility {}
