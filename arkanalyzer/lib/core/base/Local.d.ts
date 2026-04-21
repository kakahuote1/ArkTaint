import { Stmt } from './Stmt';
import { Type } from './Type';
import { Value } from './Value';
import { ArkExport, ExportType } from '../model/ArkExport';
import { LocalSignature } from '../model/ArkSignature';
import { ModifierType } from '../model/ArkBaseModel';
import { ArkMethod } from '../model/ArkMethod';
/**
 * @category core/base
 */
export declare class Local implements Value, ArkExport {
    private name;
    private type;
    private originalValue;
    private declaringStmt;
    private usedStmts;
    private signature?;
    private constFlag?;
    constructor(name: string, type?: Type);
    inferType(arkMethod: ArkMethod): Local;
    /**
     * Returns the name of local value.
     * @returns The name of local value.
     * @example
     * 1. get the name of local value.

     ```typescript
     arkClass.getDefaultArkMethod()?.getBody().getLocals().forEach(local => {
     const arkField = new ArkField();
     arkField.setFieldType(ArkField.DEFAULT_ARK_Field);
     arkField.setDeclaringClass(defaultClass);
     arkField.setType(local.getType());
     arkField.setName(local.getName());
     arkField.genSignature();
     defaultClass.addField(arkField);
     });
     ```
     */
    getName(): string;
    setName(name: string): void;
    /**
     * Returns the type of this local.
     * @returns The type of this local.
     */
    getType(): Type;
    setType(newType: Type): void;
    getOriginalValue(): Value | null;
    setOriginalValue(originalValue: Value): void;
    /**
     * Returns the declaring statement, which may also be a **null**.
     * For example, if the code snippet in a function is `let dd = cc + 5;` where `cc` is a **number**
     * and `dd` is not defined before, then the declaring statemet of local `dd`:
     * - its **string** text is "dd = cc + 5".
     * - the **strings** of right operand and left operand are "cc + 5" and "dd", respectively.
     * - three values are used in this statement: `cc + 5` (i.e., a normal binary operation expression), `cc` (a local), and `5` (a constant), respectively.
     * @returns The declaring statement (maybe a **null**) of the local.
     * @example
     * 1. get the statement that defines the local for the first time.

     ```typescript
     let stmt = local.getDeclaringStmt();
     if (stmt !== null) {
     ...
     }
     ```
     */
    getDeclaringStmt(): Stmt | null;
    setDeclaringStmt(declaringStmt: Stmt): void;
    /**
     * Returns an **array** of values which are contained in this local.
     * @returns An **array** of values used by this local.
     */
    getUses(): Value[];
    addUsedStmt(usedStmt: Stmt): void;
    /**
     * Returns an array of statements used by the local, i.e., the statements in which the local participate.
     * For example, if the code snippet is `let dd = cc + 5;` where `cc` is a local and `cc` only appears once,
     * then the length of **array** returned is 1 and `Stmts[0]` will be same as the example described
     * in the `Local.getDeclaringStmt()`.
     * @returns An array of statements used by the local.
     */
    getUsedStmts(): Stmt[];
    /**
     * Get a string of local name in Local
     * @returns The string of local name.
     * @example
     * 1. get a name string.

     ```typescript
     for (const value of stmt.getUses()) {
     const name = value.toString();
     ...
     }
     ```
     */
    toString(): string;
    getExportType(): ExportType;
    getModifiers(): number;
    containsModifier(modifierType: ModifierType): boolean;
    getSignature(): LocalSignature;
    setSignature(signature: LocalSignature): void;
    getConstFlag(): boolean;
    setConstFlag(newConstFlag: boolean): void;
}
//# sourceMappingURL=Local.d.ts.map