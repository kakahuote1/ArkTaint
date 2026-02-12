import { FieldSignature } from '../model/ArkSignature';
import { Local } from './Local';
import { ClassType, Type } from './Type';
import { Value } from './Value';
import { ArkMethod } from '../model/ArkMethod';
import { Stmt } from './Stmt';
/**
 * @category core/base/ref
 */
export declare abstract class AbstractRef implements Value {
    abstract getUses(): Value[];
    abstract getType(): Type;
    inferType(arkMethod: ArkMethod): AbstractRef;
}
export declare class ArkArrayRef extends AbstractRef {
    private base;
    private index;
    constructor(base: Local, index: Value);
    /**
     * Returns the base of this array reference. Array reference refers to access to array elements.
     * Array references usually consist of an local variable and an index.
     * For example, `a[i]` is a typical array reference, where `a` is the base (i.e., local variable)
     * pointing to the actual memory location where the array is stored
     * and `i` is the index indicating access to the `i-th` element from array `a`.
     * @returns the base of this array reference.
     * @example
     * 1. Get the base and the specific elements.

     ```typescript
     // Create an array
     let myArray: number[] = [10, 20, 30, 40];
     // Create an ArrayRef object representing a reference to myArray[2]
     let arrayRef = new ArkArrayRef(myArray, 2);
     // Use the getBase() method to get the base of the array
     let baseArray = arrayRef.getBase();

     console.log("Base array:", baseArray);  // Output: Base array: [10, 20, 30, 40]

     // Use baseArray and obeject index of ArrayRef to access to specific array elements
     let element = baseArray[arrayRef.index];
     console.log("Element at index", arrayRef.index, ":", element);  // Output: Element at index 2 : 30
     ```
     */
    getBase(): Local;
    setBase(newBase: Local): void;
    /**
     * Returns the index of this array reference.
     * In TypeScript, an array reference means that the variable stores
     * the memory address of the array rather than the actual data of the array.
     * @returns The index of this array reference.
     */
    getIndex(): Value;
    setIndex(newIndex: Value): void;
    getType(): Type;
    getUses(): Value[];
    toString(): string;
}
export declare abstract class AbstractFieldRef extends AbstractRef {
    private fieldSignature;
    constructor(fieldSignature: FieldSignature);
    /**
     * Returns the the field name as a **string**.
     * @returns The the field name.
     */
    getFieldName(): string;
    /**
     * Returns a field signature, which consists of a class signature,
     * a **string** field name, and a **boolean** label indicating whether it is static or not.
     * @returns The field signature.
     * @example
     * 1. Compare two Fields

     ```typescript
     const fieldSignature = new FieldSignature();
     fieldSignature.setFieldName(...);
     const fieldRef = new ArkInstanceFieldRef(baseValue as Local, fieldSignature);
     ...
     if (fieldRef.getFieldSignature().getFieldName() ===
     targetField.getFieldSignature().getFieldName()) {
     ...
     }
     ```
     */
    getFieldSignature(): FieldSignature;
    setFieldSignature(newFieldSignature: FieldSignature): void;
    getType(): Type;
}
export declare class ArkInstanceFieldRef extends AbstractFieldRef {
    private base;
    private dynamic?;
    constructor(base: Local, fieldSignature: FieldSignature, dynamic?: boolean);
    isDynamic(): boolean;
    /**
     * Returns the local of field, showing which object this field belongs to.
     * A {@link Local} consists of :
     * - Name: the **string** name of local value, e.g., "$temp0".
     * - Type: the type of value.
     * @returns The object that the field belongs to.
     * @example
     * 1. Get a base.

     ```typescript
     if (expr instanceof ArkInstanceFieldRef) {
     ...
     let base = expr.getBase();
     if (base.getName() == 'this') {
     ...
     }
     ...
     }
     ```
     */
    getBase(): Local;
    setBase(newBase: Local): void;
    getUses(): Value[];
    toString(): string;
    inferType(arkMethod: ArkMethod): AbstractRef;
}
export declare class ArkStaticFieldRef extends AbstractFieldRef {
    constructor(fieldSignature: FieldSignature);
    getUses(): Value[];
    toString(): string;
}
export declare class ArkParameterRef extends AbstractRef {
    private index;
    private paramType;
    constructor(index: number, paramType: Type);
    getIndex(): number;
    setIndex(index: number): void;
    getType(): Type;
    setType(newType: Type): void;
    inferType(arkMethod: ArkMethod): AbstractRef;
    getUses(): Value[];
    toString(): string;
}
export declare class ArkThisRef extends AbstractRef {
    private type;
    constructor(type: ClassType);
    getType(): ClassType;
    getUses(): Value[];
    toString(): string;
}
export declare class ArkCaughtExceptionRef extends AbstractRef {
    private type;
    constructor(type: Type);
    getType(): Type;
    getUses(): Value[];
    toString(): string;
}
export declare class GlobalRef extends AbstractRef {
    private name;
    private ref;
    private usedStmts;
    constructor(name: string, ref?: Value);
    getName(): string;
    getUses(): Value[];
    getType(): Type;
    getRef(): Value | null;
    setRef(value: Value): void;
    getUsedStmts(): Stmt[];
    addUsedStmts(usedStmts: Stmt | Stmt[]): void;
    toString(): string;
}
export declare class ClosureFieldRef extends AbstractRef {
    private base;
    private fieldName;
    private type;
    constructor(base: Local, fieldName: string, type: Type);
    getUses(): Value[];
    getBase(): Local;
    getType(): Type;
    setType(type: Type): void;
    getFieldName(): string;
    toString(): string;
    inferType(arkMethod: ArkMethod): AbstractRef;
}
