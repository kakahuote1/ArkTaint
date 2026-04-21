export const taint = {
    Source(): string {
        return "route-taint";
    },
    Sink(value: any): void {
        void value;
    },
};

export class NavPathStack {
    private static stack: { name: string; params?: any }[] = [];

    pushPath(options: { name: string; params?: any }): void {
        NavPathStack.stack.push({ name: options.name, params: options.params });
    }

    replacePath(options: { name: string; params?: any }): void {
        if (NavPathStack.stack.length > 0) {
            NavPathStack.stack.pop();
        }
        NavPathStack.stack.push({ name: options.name, params: options.params });
    }

    pop(): void {
        if (NavPathStack.stack.length > 0) {
            NavPathStack.stack.pop();
        }
    }

    back(): void {
        this.pop();
    }

    getParams(): any {
        if (NavPathStack.stack.length === 0) {
            return { token: "safe-default" };
        }
        return NavPathStack.stack[NavPathStack.stack.length - 1].params;
    }
}

export class FakeNavPathStack {
    getParams(): any {
        return { token: "fake-token" };
    }
}
