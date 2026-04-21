import { ArkFile } from '../ArkFile';
import ts from 'ohos-typescript';
import { ArkNamespace } from '../ArkNamespace';
export declare function buildArkNamespace(node: ts.ModuleDeclaration, declaringInstance: ArkFile | ArkNamespace, ns: ArkNamespace, sourceFile: ts.SourceFile): void;
export declare function mergeNameSpaces(arkNamespaces: ArkNamespace[]): ArkNamespace[];
//# sourceMappingURL=ArkNamespaceBuilder.d.ts.map