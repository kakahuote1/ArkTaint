import ts from 'ohos-typescript';
import { Decorator } from '../base/Decorator';
import { ArkError } from '../common/ArkError';
import { ArkMetadata, ArkMetadataKind, ArkMetadataType } from './ArkMetadata';
export declare enum ModifierType {
    PRIVATE = 1,
    PROTECTED = 2,
    PUBLIC = 4,
    EXPORT = 8,
    STATIC = 16,
    ABSTRACT = 32,
    ASYNC = 64,
    CONST = 128,
    ACCESSOR = 256,
    DEFAULT = 512,
    IN = 1024,
    READONLY = 2048,
    OUT = 4096,
    OVERRIDE = 8192,
    DECLARE = 16384,
    TYPE = 32768,
    LAZY = 65536
}
export declare const MODIFIER_TYPE_MASK = 65535;
export declare function modifierKind2Enum(kind: ts.SyntaxKind): ModifierType;
export declare function modifiers2stringArray(modifiers: number): string[];
export declare abstract class ArkBaseModel {
    protected modifiers?: number;
    protected decorators?: Set<Decorator>;
    protected metadata?: ArkMetadata;
    getMetadata(kind: ArkMetadataKind): ArkMetadataType | undefined;
    setMetadata(kind: ArkMetadataKind, value: ArkMetadataType): void;
    getModifiers(): number;
    setModifiers(modifiers: number): void;
    addModifier(modifier: ModifierType | number): void;
    removeModifier(modifier: ModifierType): void;
    isStatic(): boolean;
    isProtected(): boolean;
    isPrivate(): boolean;
    isPublic(): boolean;
    isReadonly(): boolean;
    isAbstract(): boolean;
    isExport(): boolean;
    isDefault(): boolean;
    /** @deprecated Use {@link isExport} instead. */
    isExported(): boolean;
    isDeclare(): boolean;
    containsModifier(modifierType: ModifierType): boolean;
    getDecorators(): Decorator[];
    setDecorators(decorators: Set<Decorator>): void;
    addDecorator(decorator: Decorator): void;
    removeDecorator(kind: string): void;
    hasBuilderDecorator(): boolean;
    getStateDecorators(): Decorator[];
    hasBuilderParamDecorator(): boolean;
    hasEntryDecorator(): boolean;
    hasComponentDecorator(): boolean;
    hasDecorator(kind: string | Set<string>): boolean;
    protected validateFields(fields: string[]): ArkError;
    abstract validate(): ArkError;
}
