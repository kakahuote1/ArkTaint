import { ImportInfoInference, MethodInference, StmtInference } from '../ModelInference';
import { ArkMethod } from '../../model/ArkMethod';
import { InferenceBuilder } from '../InferenceBuilder';
import { FieldRefInference } from '../ValueInference';
import { Stmt } from '../../base/Stmt';
import { ArkInstanceFieldRef } from '../../base/Ref';
export declare class AbcMethodInference extends MethodInference {
    preInfer(arkMethod: ArkMethod): void;
    private inferArkUIComponentLifeCycleMethod;
}
export declare class AbcInferenceBuilder extends InferenceBuilder {
    buildImportInfoInference(): ImportInfoInference;
    buildMethodInference(): MethodInference;
    buildStmtInference(): StmtInference;
}
export declare class AbcFieldRefInference extends FieldRefInference {
    getValueName(): string;
    preInfer(value: ArkInstanceFieldRef, stmt: Stmt): boolean;
}
