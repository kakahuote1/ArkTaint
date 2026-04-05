import { Button, taint } from "./taint_mock";

export function registerClick(button: Button, callback: () => void): void {
    button.onClick(callback);
}

export function registerClickNested(button: Button, callback: () => void): void {
    registerClick(button, callback);
}

export function createSinkingHandler(taint_src: any): () => void {
    return () => {
        taint.Sink(taint_src);
    };
}

export function createIgnoringHandler(taint_src: any): () => void {
    return () => {
        void taint_src;
        taint.Sink("safe");
    };
}

export function createSafeHandler(): () => void {
    return () => {
        taint.Sink("safe");
    };
}
