import { ArkInstanceInvokeExpr, ArkStaticInvokeExpr, NormalBinaryOperator } from '../../core/base/Expr';
import { Stmt } from '../../core/base/Stmt';
import { ArkClass } from '../../core/model/ArkClass';
import { ClassSignature } from '../../core/model/ArkSignature';
import { ArkNamespace } from '../../core/model/ArkNamespace';
export declare const CLASS_CATEGORY_COMPONENT = 100;
export declare class PrinterUtils {
    static classOriginTypeToString: Map<number, string>;
    static isAnonymousClass(name: string): boolean;
    static isDefaultClass(name: string): boolean;
    static isAnonymousMethod(name: string): boolean;
    static isConstructorMethod(name: string): boolean;
    static isDeIncrementStmt(stmt: Stmt | null, op: NormalBinaryOperator): boolean;
    static isTemp(name: string): boolean;
    static getOriginType(cls: ArkClass): number;
    static isComponentPop(invokeExpr: ArkStaticInvokeExpr): boolean;
    static isComponentCreate(invokeExpr: ArkStaticInvokeExpr): boolean;
    static isConstructorInvoke(invokeExpr: ArkInstanceInvokeExpr): boolean;
    static isComponentAttributeInvoke(invokeExpr: ArkInstanceInvokeExpr, visitor?: Set<ArkInstanceInvokeExpr>): boolean;
    static isComponentIfBranchInvoke(invokeExpr: ArkStaticInvokeExpr): boolean;
    static isComponentIfElseInvoke(invokeExpr: ArkStaticInvokeExpr): boolean;
    static getStaticInvokeClassFullName(classSignature: ClassSignature, namespace?: ArkNamespace): string;
    static isIdentifierText(text: string): boolean;
    static escape(text: string): string;
}
//# sourceMappingURL=PrinterUtils.d.ts.map