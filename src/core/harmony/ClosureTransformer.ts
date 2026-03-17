import { ArkMethod } from "../../../arkanalyzer/out/src/core/model/ArkMethod";
import { ArkAssignStmt } from "../../../arkanalyzer/out/src/core/base/Stmt";
import { Local } from "../../../arkanalyzer/out/src/core/base/Local";
import { ArkInstanceFieldRef, ArkParameterRef } from "../../../arkanalyzer/out/src/core/base/Ref";

export class ClosureTransformer {
    public static transform(method: ArkMethod): void {
        const cfg = method.getCfg();
        const body = method.getBody();
        if (!cfg || !body) return;

        // 1. 识别捕获变量：通过 Body 获取 Locals
        const capturedVars = this.identifyCapturedVariables(method);
        if (capturedVars.length === 0) return;

        const firstBlock = cfg.getBlocks()[0];
        if (!firstBlock) return;

        // 2. 构造解包逻辑
        const closureLocal = new Local("%closure");
        const unpackingStmts: any[] = [];

        // %closure = %param_last
        const paramIndex = method.getParameters().length;
        const paramRef = new ArkParameterRef(paramIndex, (closureLocal as any).getType?.());
        unpackingStmts.push(new ArkAssignStmt(closureLocal, paramRef));

        // v = %closure.v
        for (const v of capturedVars) {
            const fieldSig = (v as any).getSignature?.() || v.getName();
            const fieldRef = new ArkInstanceFieldRef(closureLocal, fieldSig);
            unpackingStmts.push(new ArkAssignStmt(v, fieldRef));
        }

        // 3. 插入到第一个 Block 的语句序列中
        const originalStmts = firstBlock.getStmts();
        (firstBlock as any).stmts = [...unpackingStmts, ...originalStmts];
    }

    private static identifyCapturedVariables(method: ArkMethod): Local[] {
        const captured: Local[] = [];
        const body = method.getBody();
        if (!body) return [];

        // 遍历 Body 中的 Locals
        for (const local of body.getLocals().values()) {
            const declaringMethod = (local as any).getDeclaringMethod?.();
            if (declaringMethod && declaringMethod !== method) {
                captured.push(local);
            }
        }
        return captured;
    }
    // 确保 createVirtualFieldRef 使用的是变量名作为唯一标识
private static createVirtualFieldRef(base: Local, targetVar: Local): ArkInstanceFieldRef {
    // 论文中提到：captured variables are packed into %closure
    // 这里我们必须保证外部打包进 %closure.taint_src 和内部解包 %closure.taint_src 使用的是同一个属性名
    const fieldName = targetVar.getName(); 
    // 伪造一个 FieldSignature，确保它能被 PAG 识别
    const dummySignature = (targetVar as any).getSignature?.() || fieldName;
    return new ArkInstanceFieldRef(base, dummySignature);
}
}