import { ArkFile, Language } from './ArkFile';
import { LineColPosition } from '../base/Position';
import { ExportInfo, FromInfo } from './ArkExport';
import { ArkBaseModel } from './ArkBaseModel';
import { ArkError } from '../common/ArkError';
/**
 * @category core/model
 */
export declare class ImportInfo extends ArkBaseModel implements FromInfo {
    private importClauseName;
    private importType;
    private importFrom?;
    private nameBeforeAs?;
    private declaringArkFile;
    private originTsPosition?;
    private tsSourceCode?;
    private lazyExportInfo?;
    constructor();
    /**
     * Returns the program language of the file where this import info defined.
     */
    getLanguage(): Language;
    build(importClauseName: string, importType: string, importFrom: string, originTsPosition: LineColPosition, modifiers: number, nameBeforeAs?: string): void;
    getOriginName(): string;
    /**
     * Returns the export information, i.e., the actual reference generated at the time of call.
     * The export information includes: clause's name, clause's type, modifiers, location
     * where it is exported from, etc. If the export information could not be found, **null** will be returned.
     * @returns The export information. If there is no export information, the return will be a **null**.
     */
    getLazyExportInfo(): ExportInfo | null;
    getExportInfo(): ExportInfo | null | undefined;
    setExportInfo(exportInfo: ExportInfo | null): void;
    setDeclaringArkFile(declaringArkFile: ArkFile): void;
    getDeclaringArkFile(): ArkFile;
    getImportClauseName(): string;
    setImportClauseName(importClauseName: string): void;
    getImportType(): string;
    setImportType(importType: string): void;
    setImportFrom(importFrom: string): void;
    getNameBeforeAs(): string | undefined;
    setNameBeforeAs(nameBeforeAs: string | undefined): void;
    setOriginTsPosition(originTsPosition: LineColPosition): void;
    getOriginTsPosition(): LineColPosition;
    setTsSourceCode(tsSourceCode: string): void;
    getTsSourceCode(): string;
    getFrom(): string | undefined;
    isDefault(): boolean;
    validate(): ArkError;
}
