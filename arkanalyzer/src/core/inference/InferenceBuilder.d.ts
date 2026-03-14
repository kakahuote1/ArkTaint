import { ClassInference, FileInference, ImportInfoInference, MethodInference, StmtInference } from './ModelInference';
import { InferLanguage, ValueInference } from './ValueInference';
import { Value } from '../base/Value';
export declare abstract class InferenceBuilder {
    buildFileInference(): FileInference;
    abstract buildImportInfoInference(): ImportInfoInference;
    buildClassInference(): ClassInference;
    buildMethodInference(): MethodInference;
    abstract buildStmtInference(): StmtInference;
    getValueInferences(lang: InferLanguage): ValueInference<Value>[];
}
