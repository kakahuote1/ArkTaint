import { Value } from '../base/Value';
import { BasicBlock } from '../graph/BasicBlock';
import { ArkClass } from '../model/ArkClass';
import { ArkFile } from '../model/ArkFile';
import { ArkMethod } from '../model/ArkMethod';
import { ArkNamespace } from '../model/ArkNamespace';
export declare class VisibleValue {
    private scopeChain;
    private currScope;
    private currVisibleValues;
    constructor();
    /** get values that is visible in curr scope */
    getCurrVisibleValues(): Value[];
    getScopeChain(): Scope[];
    /** udpate visible values after entered a scope, only support step by step */
    updateIntoScope(model: ArkModel): void;
    /** udpate visible values after left a scope, only support step by step */
    updateOutScope(): void;
    /** clear up previous scope */
    private deleteScope;
    /** add this scope to scope chain and update visible values */
    private addScope;
    private getTargetDepth;
    private getVisibleValuesIntoFileOrNameSpace;
    private getVisibleValuesIntoClass;
    private getVisibleValuesIntoMethod;
    private getVisibleValuesIntoBasicBlock;
}
type ArkModel = ArkFile | ArkNamespace | ArkClass | ArkMethod | BasicBlock;
export declare class Scope {
    values: Value[];
    depth: number;
    arkModel: ArkModel | null;
    constructor(values: Value[], depth?: number, arkModel?: ArkModel | null);
}
export {};
//# sourceMappingURL=VisibleValue.d.ts.map