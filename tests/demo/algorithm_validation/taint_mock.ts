export namespace taint {
    export function Sink(data: any): void {
        console.log("Sink called", data);
    }
}

export interface CustomDialogControllerOptions {
    builder?: () => void;
    cancel?: () => void;
    confirm?: () => void;
}

export class CustomDialogController {
    private options: CustomDialogControllerOptions;

    constructor(options: CustomDialogControllerOptions) {
        this.options = options;
    }

    open(): void {
        void this.options;
    }
}

export function animateTo(
    params: { duration: number; onFinish?: () => void },
    cb: () => void
): void {
    void params;
    void cb;
}
