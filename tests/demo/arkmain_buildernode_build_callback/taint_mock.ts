export class UIAbility {}

export interface UIContext {}

export interface BuildOptions {
    nestingBuilderSupported?: boolean;
}

export type CustomBuilder = () => void;
export type CustomBuilderT<T> = (value: T) => void;

export function wrapBuilder<T>(builder: T): WrappedBuilder<T> {
    return new WrappedBuilder(builder);
}

export class WrappedBuilder<T> {
    public builder: T;

    public constructor(builder: T) {
        this.builder = builder;
    }
}

export class BuilderNode<T = undefined> {
    build(builder: WrappedBuilder<CustomBuilder>): void;
    build(builder: WrappedBuilder<CustomBuilderT<T>>, arg: T): void;
    build(builder: WrappedBuilder<CustomBuilderT<T>>, arg: T, options: BuildOptions): void;
    build(builder: WrappedBuilder<CustomBuilder | CustomBuilderT<T>>, arg?: T, options?: BuildOptions): void {
        void builder;
        void arg;
        void options;
    }
}
