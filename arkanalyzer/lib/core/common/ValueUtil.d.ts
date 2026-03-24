import { BigIntConstant, Constant, StringConstant } from '../base/Constant';
export declare const EMPTY_STRING = "";
export declare class ValueUtil {
    private static readonly NumberConstantCache;
    static readonly EMPTY_STRING_CONSTANT: StringConstant;
    static dispose(): void;
    static getOrCreateNumberConst(n: number | string): Constant;
    static createBigIntConst(bigInt: bigint): BigIntConstant;
    static createStringConst(str: string): Constant;
    static createConst(str: string): Constant;
    static getUndefinedConst(): Constant;
    static getNullConstant(): Constant;
    static getBooleanConstant(value: boolean): Constant;
}
//# sourceMappingURL=ValueUtil.d.ts.map