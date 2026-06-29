export interface DecoratorKey {
    decoratorName: string;
    ownerKind: "namespace" | "class" | "method" | "field";
    ownerName: string;
    sourceFile: string;
}

export function decoratorKeyString(key: Pick<DecoratorKey, "decoratorName">): string {
    return JSON.stringify({
        decoratorName: key.decoratorName,
    });
}
