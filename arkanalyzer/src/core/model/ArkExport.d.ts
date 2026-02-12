import { LineColPosition } from '../base/Position';
import { ArkFile, Language } from './ArkFile';
import { ArkSignature, ClassSignature, LocalSignature, MethodSignature, NamespaceSignature } from './ArkSignature';
import { ArkBaseModel, ModifierType } from './ArkBaseModel';
import { ArkError } from '../common/ArkError';
import { CommentsMetadata } from './ArkMetadata';
import { ArkNamespace } from './ArkNamespace';
export type ExportSignature = NamespaceSignature | ClassSignature | MethodSignature | LocalSignature;
export declare enum ExportType {
    NAME_SPACE = 0,
    CLASS = 1,
    METHOD = 2,
    LOCAL = 3,
    TYPE = 4,
    UNKNOWN = 9
}
export interface ArkExport extends ArkSignature {
    getModifiers(): number;
    containsModifier(modifierType: ModifierType): boolean;
    getName(): string;
    getExportType(): ExportType;
}
export interface FromInfo {
    isDefault(): boolean;
    getOriginName(): string;
    getFrom(): string | undefined;
    getDeclaringArkFile(): ArkFile;
}
/**
 * @category core/model
 */
export declare class ExportInfo extends ArkBaseModel implements FromInfo {
    private _default?;
    private nameBeforeAs?;
    private exportClauseName;
    private exportClauseType;
    private arkExport?;
    private exportFrom?;
    private originTsPosition?;
    private tsSourceCode?;
    private declaringArkFile;
    private declaringArkNamespace?;
    private constructor();
    /**
     * Returns the program language of the file where this export info defined.
     */
    getLanguage(): Language;
    getFrom(): string | undefined;
    getOriginName(): string;
    getExportClauseName(): string;
    setExportClauseType(exportClauseType: ExportType): void;
    getExportClauseType(): ExportType;
    getNameBeforeAs(): string | undefined;
    setArkExport(value: ArkExport | null): void;
    getArkExport(): ArkExport | undefined | null;
    isDefault(): boolean;
    getOriginTsPosition(): LineColPosition;
    getTsSourceCode(): string;
    getDeclaringArkFile(): ArkFile;
    getDeclaringArkNamespace(): ArkNamespace | undefined;
    static Builder: {
        new (): {
            exportInfo: ExportInfo;
            exportClauseName(exportClauseName: string): /*elided*/ any;
            exportClauseType(exportClauseType: ExportType): /*elided*/ any;
            nameBeforeAs(nameBeforeAs: string): /*elided*/ any;
            modifiers(modifiers: number): /*elided*/ any;
            originTsPosition(originTsPosition: LineColPosition): /*elided*/ any;
            tsSourceCode(tsSourceCode: string): /*elided*/ any;
            declaringArkFile(value: ArkFile): /*elided*/ any;
            declaringArkNamespace(value: ArkNamespace): /*elided*/ any;
            arkExport(value: ArkExport): /*elided*/ any;
            exportFrom(exportFrom: string): /*elided*/ any;
            setLeadingComments(commentsMetadata: CommentsMetadata): /*elided*/ any;
            setTrailingComments(commentsMetadata: CommentsMetadata): /*elided*/ any;
            build(): ExportInfo;
        };
    };
    validate(): ArkError;
}
