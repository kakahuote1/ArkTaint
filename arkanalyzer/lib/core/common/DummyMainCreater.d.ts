import { Scene } from '../../Scene';
import { ArkMethod } from '../model/ArkMethod';
/**
收集所有的onCreate，onStart等函数，构造一个虚拟函数，具体为：
%statInit()
...
count = 0
while (true) {
    if (count === 1) {
        temp1 = new ability
        temp2 = new want
        temp1.onCreate(temp2)
    }
    if (count === 2) {
        onDestroy()
    }
    ...
    if (count === *) {
        callbackMethod1()
    }
    ...
}
return
如果是instanceInvoke还要先实例化对象，如果是其他文件的类或者方法还要添加import信息
 */
export declare class DummyMainCreater {
    private entryMethods;
    private classLocalMap;
    private dummyMain;
    private scene;
    private tempLocalIndex;
    constructor(scene: Scene);
    setEntryMethods(methods: ArkMethod[]): void;
    createDummyMain(): void;
    private addStaticInit;
    private addClassInit;
    private addParamInit;
    private addBranches;
    private createDummyMainCfg;
    private addCfg2Stmt;
    getDummyMain(): ArkMethod;
    private getEntryMethodsFromComponents;
    private classInheritsAbility;
    getMethodsFromAllAbilities(): ArkMethod[];
    getCallbackMethods(): ArkMethod[];
}
//# sourceMappingURL=DummyMainCreater.d.ts.map