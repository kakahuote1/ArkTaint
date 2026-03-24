import { LineColPosition } from '../base/Position';
import { Stmt } from '../base/Stmt';
import { ArkClass } from './ArkClass';
import { FieldSignature } from './ArkSignature';
import { Type } from '../base/Type';
import { ArkBaseModel } from './ArkBaseModel';
import { ArkError } from '../common/ArkError';
import { Language } from './ArkFile';
export declare enum FieldCategory {
    PROPERTY_DECLARATION = 0,
    PROPERTY_ASSIGNMENT = 1,
    SHORT_HAND_PROPERTY_ASSIGNMENT = 2,
    SPREAD_ASSIGNMENT = 3,
    PROPERTY_SIGNATURE = 4,
    ENUM_MEMBER = 5,
    INDEX_SIGNATURE = 6,
    GET_ACCESSOR = 7,
    PARAMETER_PROPERTY = 8
}
/**
 * @category core/model
 */
export declare class ArkField extends ArkBaseModel {
    private code;
    private category;
    private declaringClass;
    private questionToken;
    private exclamationToken;
    private fieldSignature;
    private originPosition?;
    private initializer;
    constructor();
    /**
     * Returns the program language of the file where this field's class defined.
     */
    getLanguage(): Language;
    getDeclaringArkClass(): ArkClass;
    setDeclaringArkClass(declaringClass: ArkClass): void;
    /**
     * Returns the codes of field as a **string.**
     * @returns the codes of field.
     */
    getCode(): string;
    setCode(code: string): void;
    getCategory(): FieldCategory;
    setCategory(category: FieldCategory): void;
    getName(): string;
    getType(): Type;
    getSignature(): FieldSignature;
    setSignature(fieldSig: FieldSignature): void;
    /**
     * Returns an array of statements used for initialization.
     * @returns An array of statements used for initialization.
     */
    getInitializer(): Stmt[];
    setInitializer(initializer: Stmt[]): void;
    setQuestionToken(questionToken: boolean): void;
    setExclamationToken(exclamationToken: boolean): void;
    getQuestionToken(): boolean;
    getExclamationToken(): boolean;
    setOriginPosition(position: LineColPosition): void;
    /**
     * Returns the original position of the field at source code.
     * @returns The original position of the field at source code.
     */
    getOriginPosition(): LineColPosition;
    validate(): ArkError;
    isPublic(): boolean;
}
//# sourceMappingURL=ArkField.d.ts.map