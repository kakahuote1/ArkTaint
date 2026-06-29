
export namespace taint {
    export function Source(data: any): void {
        void data;
    }

    export function Sink(data: any): void {
        console.log("Sink called");
    }
}
