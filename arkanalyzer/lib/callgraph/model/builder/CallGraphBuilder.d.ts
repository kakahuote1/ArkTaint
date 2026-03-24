import { CallGraph, Method } from '../CallGraph';
import { Scene } from '../../../Scene';
import { ArkMethod } from '../../../core/model/ArkMethod';
export declare class CallGraphBuilder {
    private cg;
    private scene;
    constructor(c: CallGraph, s: Scene);
    buildDirectCallGraphForScene(): void;
    buildCGNodes(methods: ArkMethod[]): void;
    buildDirectCallGraph(methods: ArkMethod[]): void;
    buildClassHierarchyCallGraph(entries: Method[], displayGeneratedMethod?: boolean): void;
    buildCHA4WholeProject(displayGeneratedMethod?: boolean): void;
    buildRapidTypeCallGraph(entries: Method[], displayGeneratedMethod?: boolean): void;
    private getDCCallee;
    setEntries(): void;
}
//# sourceMappingURL=CallGraphBuilder.d.ts.map