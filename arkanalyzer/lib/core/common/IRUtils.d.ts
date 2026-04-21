import { Value } from '../base/Value';
import { Scene } from '../../Scene';
import ts from 'ohos-typescript';
import { SceneOptions } from '../../Config';
import { CommentsMetadata } from '../model/ArkMetadata';
import { Stmt } from '../base/Stmt';
import { ArkBaseModel } from '../model/ArkBaseModel';
import { FullPosition } from '../base/Position';
export declare class IRUtils {
    static moreThanOneAddress(value: Value): boolean;
    static generateTextForStmt(scene: Scene): void;
    static setComments(metadata: Stmt | ArkBaseModel, node: ts.Node, sourceFile: ts.SourceFile, options: SceneOptions): void;
    static getCommentsMetadata(node: ts.Node, sourceFile: ts.SourceFile, options: SceneOptions, isLeading: boolean): CommentsMetadata;
    static isTempLocal(value: Value): boolean;
    static findOperandIdx(stmt: Stmt, operand: Value): number;
    static adjustOperandOriginalPositions(stmt: Stmt, oldValue: Value, newValue: Value): void;
    static generateDefaultPositions(count: number): FullPosition[];
}
//# sourceMappingURL=IRUtils.d.ts.map