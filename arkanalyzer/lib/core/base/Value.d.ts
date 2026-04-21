import { Type } from './Type';
/**
 * @category core/base
 */
export interface Value {
    /**
     * Return a list of values which are contained in this {@link Value}.
     * Value is a core interface in ArkAnalyzer, which may represent any value or expression.
     * @returns An **array** of values used by this value.
     */
    getUses(): Value[];
    /**
     * Return the type of this value. The interface is encapsulated in {@link Value}.
     * The `Type` is defined in type.ts, such as **Any**, **Unknown**, **TypeParameter**,
     * **UnclearReference**, **Primitive**, **Number**, **String**, etc.
     * @returns The type of this value.
     * @example
     * 1. In the declaration statement, determine the left-value type and right-value type.

    ```typescript
    let leftValue:Value;
    let rightValue:Value;
    ...
    if (leftValue.getType() instanceof UnknownType &&
        !(rightValue.getType() instanceof UnknownType) &&
        !(rightValue.getType() instanceof UndefinedType)) {
        ...
    }
    ```
     */
    getType(): Type;
}
//# sourceMappingURL=Value.d.ts.map