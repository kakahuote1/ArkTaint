import { Scene } from '../Scene';
import { ArkClass } from '../core/model/ArkClass';
import { ArkMethod } from '../core/model/ArkMethod';
import { ClassSignature, MethodSignature } from '../core/model/ArkSignature';
export declare class MethodSignatureManager {
    private _workList;
    private _processedList;
    get workList(): MethodSignature[];
    set workList(list: MethodSignature[]);
    get processedList(): MethodSignature[];
    set processedList(list: MethodSignature[]);
    findInWorkList(signature: MethodSignature): MethodSignature | undefined;
    findInProcessedList(signature: MethodSignature): boolean;
    addToWorkList(signature: MethodSignature): void;
    addToProcessedList(signature: MethodSignature): void;
    removeFromWorkList(signature: MethodSignature): void;
    removeFromProcessedList(signature: MethodSignature): void;
}
export declare class SceneManager {
    private _scene;
    get scene(): Scene;
    set scene(value: Scene);
    getMethod(method: MethodSignature): ArkMethod | null;
    getClass(arkClass: ClassSignature): ArkClass | null;
    getExtendedClasses(arkClass: ClassSignature): ArkClass[];
}
export declare function isItemRegistered<T>(item: T, array: T[], compareFunc: (a: T, b: T) => boolean): boolean;
export declare function splitStringWithRegex(input: string): string[];
export declare function printCallGraphDetails(methods: Set<MethodSignature>, calls: Map<MethodSignature, MethodSignature[]>, rootDir: string): void;
export declare function extractLastBracketContent(input: string): string;
//# sourceMappingURL=callGraphUtils.d.ts.map