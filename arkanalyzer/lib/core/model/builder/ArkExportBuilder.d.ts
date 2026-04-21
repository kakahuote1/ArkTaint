import ts from 'ohos-typescript';
import { LineColPosition } from '../../base/Position';
import { ArkExport, ExportInfo, FromInfo } from '../ArkExport';
import { ArkFile } from '../ArkFile';
import { ArkNamespace } from '../ArkNamespace';
export { buildExportInfo, buildExportAssignment, buildExportDeclaration };
declare function buildExportInfo(arkInstance: ArkExport, arkFile: ArkFile, line: LineColPosition): ExportInfo;
export declare function buildDefaultExportInfo(im: FromInfo, file: ArkFile, arkExport?: ArkExport): ExportInfo;
declare function buildExportDeclaration(node: ts.ExportDeclaration, sourceFile: ts.SourceFile, arkFile: ArkFile): ExportInfo[];
declare function buildExportAssignment(node: ts.ExportAssignment, sourceFile: ts.SourceFile, arkFile: ArkFile): ExportInfo[];
/**
 * export const c = '', b = 1;
 * @param node
 * @param sourceFile
 * @param arkFile
 */
export declare function buildExportVariableStatement(node: ts.VariableStatement, sourceFile: ts.SourceFile, arkFile: ArkFile, namespace?: ArkNamespace): ExportInfo[];
/**
 * export type MyType = string;
 * @param node
 * @param sourceFile
 * @param arkFile
 */
export declare function buildExportTypeAliasDeclaration(node: ts.TypeAliasDeclaration, sourceFile: ts.SourceFile, arkFile: ArkFile): ExportInfo[];
export declare function isExported(modifierArray: ts.NodeArray<ts.ModifierLike> | undefined): boolean;
//# sourceMappingURL=ArkExportBuilder.d.ts.map