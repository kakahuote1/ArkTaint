import { Button, taint } from "./taint_mock";

export function registerClick(button: Button, callback: (payload: any) => void): void {
    button.onClick(callback);
}

export function registerClickNested(button: Button, callback: (payload: any) => void): void {
    registerClick(button, callback);
}

export function createSinkingHandler(): (payload: any) => void {
    return (payload: any) => {
        taint.Sink(payload);
    };
}

export function createConstantHandler(): (payload: any) => void {
    return (_payload: any) => {
        taint.Sink("safe");
    };
}

