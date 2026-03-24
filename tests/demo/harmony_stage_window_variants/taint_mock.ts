export const taint = {
    Source(): string {
        return "stage-window-taint";
    },
    Sink(value: any): void {
        void value;
    },
};

export class AbilityStage {}

export class WindowStage {
    loadContent(_page: string, callback: (err: any, data: any) => void): void {
        callback(null, { token: "window-data" });
    }
}

export class SharedStageStore {
    static token: string = "";
}
