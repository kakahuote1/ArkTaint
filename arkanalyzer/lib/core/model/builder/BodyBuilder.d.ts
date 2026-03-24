import { ArkBody } from '../ArkBody';
import { ArkMethod } from '../ArkMethod';
import { MethodSignature } from '../ArkSignature';
import { CfgBuilder } from '../../graph/builder/CfgBuilder';
import * as ts from 'ohos-typescript';
import { GlobalRef } from '../../base/Ref';
import { FullPosition } from '../../base/Position';
export declare class BodyBuilder {
    private cfgBuilder;
    private globals?;
    private paramsPosition;
    constructor(methodSignature: MethodSignature, sourceAstNode: ts.Node, declaringMethod: ArkMethod, sourceFile: ts.SourceFile);
    build(): ArkBody | null;
    getCfgBuilder(): CfgBuilder;
    getGlobals(): Map<string, GlobalRef> | undefined;
    setGlobals(globals: Map<string, GlobalRef>): void;
    getParamsPositions(): Map<string, FullPosition>;
    setParamsPositions(paramsPosition: Map<string, FullPosition>): void;
    /**
     * Find out all locals in the parent method which are used by the childrenChain, these locals are the closures of the root node of the childrenChain.
     * childrenChain contains all nested method from the root node of the childrenChain.
     * baseLocals are all locals defined in the outer function.
     * allNestedLocals are collect all locals defined in all outer functions of this childrenChain.
     * Only the globals of the root of the childrenChain, which are in the baseLocals but not in the allNestedLocals are the actual closures that in baseLocals.
     */
    private findClosuresUsedInNested;
    /**
     * 1. Find out all locals in the parent method which are used by the childrenChain, these locals are the closures of the root node of the childrenChain.
     * 2. Create a lexical env local in the parent method, and pass it to root node of the childrenChain through the method signature.
     * 3. Update the root node of the childrenChain to add parameterRef assign stmt and closureRef assign stmt.
     * 4. Recursively do this for all nested method level by level.
     */
    private buildLexicalEnv;
    /**
     * Find out and tag all closures from globals, and remove closures from both globals and locals.
     * Precondition: body build has been done. All locals, globals and closures are both set as Local in body,
     * while potential globals and closures are also recorded in bodybuilder.
     * Constraint: only the outermost function can call this method to recursively handle closures of itself as well as all nested methods.
     */
    handleGlobalAndClosure(): void;
    private freeBodyBuilder;
    private updateLocalTypesWithTypeAlias;
    private inferUnclearReferenceTypeWithTypeAlias;
    private generateNestedMethodChains;
    private getNestedChildrenChains;
    private moveCurrentMethodLocalToGlobal;
    private reorganizeGlobalAndLocal;
    private inferTypesDefineInOuter;
    private updateNestedMethodUsedInOuter;
    private updateNestedMethodWithClosures;
    private updateOuterMethodWithClosures;
    private getOriginalNestedMethodName;
    private updateGlobalInfoWithClosures;
    private updateLocalInfoWithClosures;
    private updateAbstractInvokeExprWithClosures;
    private createNewSignatureWithClosures;
    private updateSignatureAndArgsInArkInvokeExpr;
    private addClosureParamsAssignStmts;
}
//# sourceMappingURL=BodyBuilder.d.ts.map