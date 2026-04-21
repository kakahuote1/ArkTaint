import { Scene } from '../Scene';
import { ArkMethod } from '../core/model/ArkMethod';
import { Stmt } from '../core/base/Stmt';
export declare const LIFECYCLE_METHOD_NAME: string[];
export declare const CALLBACK_METHOD_NAME: string[];
export declare const COMPONENT_LIFECYCLE_METHOD_NAME: string[];
export interface AbilityMessage {
    srcEntry: string;
    name: string;
    srcEntrance: string;
}
export declare function getCallbackMethodFromStmt(stmt: Stmt, scene: Scene): ArkMethod | null;
export declare function addCfg2Stmt(method: ArkMethod): void;
//# sourceMappingURL=entryMethodUtils.d.ts.map