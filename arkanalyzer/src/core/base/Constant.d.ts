import { Type } from './Type';
import { Value } from './Value';
/**
 * @category core/base
 */
export declare class Constant implements Value {
    private readonly value;
    private readonly type;
    constructor(value: string, type: Type);
    /**
     * Returns the constant's value as a **string**.
     * @returns The constant's value.
     */
    getValue(): string;
    getUses(): Value[];
    /**
     * Returns the type of this constant.
     * @returns The type of this constant.
     */
    getType(): Type;
    /**
     * Get a string of constant value in Constant.
     * @returns The string of constant value.
     */
    toString(): string;
}
export declare class BooleanConstant extends Constant {
    private static readonly FALSE;
    private static readonly TRUE;
    constructor(value: boolean);
    static getInstance(value: boolean): BooleanConstant;
}
export declare class NumberConstant extends Constant {
    constructor(value: string);
}
export declare class BigIntConstant extends Constant {
    constructor(value: bigint);
}
export declare class StringConstant extends Constant {
    constructor(value: string);
}
export declare class NullConstant extends Constant {
    private static readonly INSTANCE;
    constructor();
    static getInstance(): NullConstant;
}
export declare class UndefinedConstant extends Constant {
    private static readonly INSTANCE;
    constructor();
    static getInstance(): UndefinedConstant;
}
