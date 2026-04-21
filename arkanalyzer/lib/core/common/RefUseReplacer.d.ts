import { AbstractRef } from '../base/Ref';
import { Value } from '../base/Value';
/**
 * Replace old use of a Ref inplace
 */
export declare class RefUseReplacer {
    private oldUse;
    private newUse;
    constructor(oldUse: Value, newUse: Value);
    caseRef(ref: AbstractRef): void;
    private caseFieldRef;
    private caseArrayRef;
}
//# sourceMappingURL=RefUseReplacer.d.ts.map