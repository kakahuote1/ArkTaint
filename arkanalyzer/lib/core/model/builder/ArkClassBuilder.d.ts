import { ArkFile } from '../ArkFile';
import { ArkMethod } from '../ArkMethod';
import { ArkNamespace } from '../ArkNamespace';
import ts from 'ohos-typescript';
import { ArkClass } from '../ArkClass';
export type ClassLikeNode = ts.ClassDeclaration | ts.InterfaceDeclaration | ts.EnumDeclaration | ts.ClassExpression | ts.TypeLiteralNode | ts.StructDeclaration | ts.ObjectLiteralExpression;
export declare function buildDefaultArkClassFromArkFile(arkFile: ArkFile, defaultClass: ArkClass, astRoot: ts.SourceFile): void;
export declare function buildDefaultArkClassFromArkNamespace(arkNamespace: ArkNamespace, defaultClass: ArkClass, nsNode: ts.ModuleDeclaration, sourceFile: ts.SourceFile): void;
export declare function buildNormalArkClassFromArkMethod(clsNode: ClassLikeNode, cls: ArkClass, sourceFile: ts.SourceFile, declaringMethod?: ArkMethod): void;
export declare function buildNormalArkClassFromArkFile(clsNode: ClassLikeNode, arkFile: ArkFile, cls: ArkClass, sourceFile: ts.SourceFile, declaringMethod?: ArkMethod): void;
export declare function buildNormalArkClassFromArkNamespace(clsNode: ClassLikeNode, arkNamespace: ArkNamespace, cls: ArkClass, sourceFile: ts.SourceFile, declaringMethod?: ArkMethod): void;
export declare function buildNormalArkClass(clsNode: ClassLikeNode, cls: ArkClass, sourceFile: ts.SourceFile, declaringMethod?: ArkMethod): void;
//# sourceMappingURL=ArkClassBuilder.d.ts.map