export function Watch(_field: string): MethodDecorator {
    return () => {
        return;
    };
}

export function Monitor(_field: string): MethodDecorator {
    return () => {
        return;
    };
}

export namespace taint {
    export function Sink(value: unknown): void {
        void value;
    }
}
