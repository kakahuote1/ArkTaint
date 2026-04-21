import { Stmt } from '../../core/base/Stmt';
import { ArkMethod } from '../../core/model/ArkMethod';
import { Scene } from '../../Scene';
import { DVFG, DVFGNode } from '../DVFG';
export declare class DVFGBuilder {
    private dvfg;
    private scene;
    constructor(dvfg: DVFG, s: Scene);
    build(): void;
    buildForSingleMethod(m: ArkMethod): void;
    private getStmtUsedValues;
    private getUsedValues;
    getOrNewDVFGNode(stmt: Stmt): DVFGNode;
    addDVFGNodes(): void;
    addDVFGEdges(): void;
}
//# sourceMappingURL=DVFGBuilder.d.ts.map