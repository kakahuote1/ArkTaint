import { ArkFile } from '../../core/model/ArkFile';
import { ArkMethod } from '../../core/model/ArkMethod';
import { ClassSignature, MethodSignature } from '../../core/model/ArkSignature';
import { ArkClass } from '../../core/model/ArkClass';
import { ArkCodeBuffer } from '../ArkStream';
import { Local } from '../../core/base/Local';
import { TransformerContext } from './SourceTransformer';
import { ArkNamespace } from '../../core/model/ArkNamespace';
import { BasePrinter } from '../base/BasePrinter';
export declare abstract class SourceBase extends BasePrinter implements TransformerContext {
    protected arkFile: ArkFile;
    protected inBuilder: boolean;
    constructor(arkFile: ArkFile, indent?: string);
    getDeclaringArkNamespace(): ArkNamespace | undefined;
    getArkFile(): ArkFile;
    getMethod(signature: MethodSignature): ArkMethod | null;
    getClass(signature: ClassSignature): ArkClass | null;
    getPrinter(): ArkCodeBuffer;
    transTemp2Code(temp: Local): string;
    isInBuilderMethod(): boolean;
    protected resolveKeywordType(keywordStr: string): string;
}
//# sourceMappingURL=SourceBase.d.ts.map