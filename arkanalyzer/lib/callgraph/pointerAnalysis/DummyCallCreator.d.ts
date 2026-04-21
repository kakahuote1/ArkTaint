import { Local } from '../../core/base/Local';
import { Stmt } from '../../core/base/Stmt';
import { ClassSignature } from '../../core/model/ArkSignature';
import { Scene } from '../../Scene';
/**
 * TODO: constructor pointer and cid
 */
export declare class DummyCallCreator {
    private scene;
    private pageMap;
    private componentMap;
    constructor(scene: Scene);
    getDummyCallByPage(classSig: ClassSignature, basePage: Local): Set<Stmt>;
    getDummyCallByComponent(classSig: ClassSignature, baseComponent: Local): Set<Stmt>;
    /**
     * build dummy call edge with class signature, including a class new expr and call back function invokes
     * @param classSig class signature
     * @returns dummy call edges
     */
    private buildDummyCallBody;
    private getComponentCallStmts;
}
//# sourceMappingURL=DummyCallCreator.d.ts.map