import ts from 'ohos-typescript';
import { ArkField } from '../ArkField';
import { ArkClass } from '../ArkClass';
import { ArkMethod } from '../ArkMethod';
export type PropertyLike = ts.PropertyDeclaration | ts.PropertyAssignment;
export declare function buildProperty2ArkField(member: ts.PropertyDeclaration | ts.PropertyAssignment | ts.ShorthandPropertyAssignment | ts.SpreadAssignment | ts.PropertySignature | ts.EnumMember, sourceFile: ts.SourceFile, cls: ArkClass): ArkField;
export declare function buildIndexSignature2ArkField(member: ts.IndexSignatureDeclaration, sourceFile: ts.SourceFile, cls: ArkClass): void;
export declare function buildGetAccessor2ArkField(member: ts.GetAccessorDeclaration, mthd: ArkMethod, sourceFile: ts.SourceFile): void;
//# sourceMappingURL=ArkFieldBuilder.d.ts.map