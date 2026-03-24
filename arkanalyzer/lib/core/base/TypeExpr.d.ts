import { Value } from './Value';
import { ArkMethod } from '../model/ArkMethod';
import { Type } from './Type';
import { ArkBaseModel } from '../model/ArkBaseModel';
/**
 * abstract type expr represents the type operations of types or values.
 * AbstractTypeExpr is different from AbstractExpr.
 * @category core/base/typeExpr
 * @extends Type
 * @example
 *  ```typescript
 *  let a = number;
 *  type A = typeof a;
 *  let b: keyof typeof a;
 *  ```
 */
export declare abstract class AbstractTypeExpr extends Type {
    abstract getUses(): Value[];
    abstract getType(): Type;
    inferType(arkMethod: ArkMethod): void;
}
/**
 * typeQuery type expr represents the get type of value with typeof.
 * @category core/base/typeExpr
 * @extends AbstractTypeExpr
 * @example
 ```typescript
 // opValue is a and type A is number
 let a = number;
 type A = typeof a;
 ```
 */
export declare class TypeQueryExpr extends AbstractTypeExpr {
    private opValue;
    private genericTypes?;
    constructor(opValue: Value | ArkBaseModel, generateTypes?: Type[]);
    setOpValue(opValue: Value | ArkBaseModel): void;
    getOpValue(): Value | ArkBaseModel;
    setGenerateTypes(types: Type[]): void;
    getGenerateTypes(): Type[] | undefined;
    addGenericType(gType: Type): void;
    getUses(): Value[];
    getType(): Type;
    getTypeString(): string;
    inferType(arkMethod: ArkMethod): void;
}
/**
 * keyof type expr represents the type operator with keyof.
 * It should be an internal expr.
 * the final type should be transferred to union type, unless it cannot find out all types within the union type.
 * @category core/base/typeExpr
 * @extends AbstractTypeExpr
 * @example
 ```typescript
 // opType is {a: 1, b: 2} and type of A is KeyofTypeExpr, which can be transferred to union type {'a', 'b'}
 type A = keyof {a: 1, b: 2};

 // opType is number and type of B is KeyofTypeExpr, which can be transferred to union type "toString" | "toFixed" | "toExponential" | ...
 type B = keyof number;
 ```
 */
export declare class KeyofTypeExpr extends AbstractTypeExpr {
    private opType;
    constructor(opType: Type);
    getOpType(): Type;
    setOpType(opType: Type): void;
    getUses(): Value[];
    getType(): Type;
    getTypeString(): string;
    inferType(arkMethod: ArkMethod): void;
}
//# sourceMappingURL=TypeExpr.d.ts.map