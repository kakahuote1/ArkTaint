import { ArkParameterRef, ArkInstanceFieldRef } from "../../arkanalyzer/out/src/core/base/Ref";
import { ArkAssignStmt, ArkInvokeStmt } from "../../arkanalyzer/out/src/core/base/Stmt";
import { ArkInstanceInvokeExpr } from "../../arkanalyzer/out/src/core/base/Expr";
import { Local } from "../../arkanalyzer/out/src/core/base/Local";
import { UnknownType } from "../../arkanalyzer/out/src/core/base/Type";
import { ClassSignature, FieldSignature, FileSignature, MethodSignature, MethodSubSignature } from "../../arkanalyzer/out/src/core/model/ArkSignature";
import {
    analyzeInvokedParams,
    mapInvokeArgsToParamAssigns,
    resolveCalleeCandidates,
} from "../core/substrate/queries/CalleeResolver";

function assert(condition: boolean, message: string): void {
    if (!condition) {
        throw new Error(message);
    }
}

function testImplicitThisArgMapping(): void {
    const baseObj = { id: "baseObj" };
    const taintArg = { id: "taintArg" };
    const pThis = new ArkParameterRef(0, UnknownType.getInstance());
    const p0 = new ArkParameterRef(1, UnknownType.getInstance());

    const paramStmts: any[] = [
        { getRightOp: () => pThis },
        { getRightOp: () => p0 },
    ];
    const invokeExpr: any = {
        getBase: () => baseObj,
    };
    const explicitArgs: any[] = [taintArg];

    const pairs = mapInvokeArgsToParamAssigns(invokeExpr, explicitArgs, paramStmts as any);
    assert(pairs.length === 2, `implicit this mapping expected 2 pairs, got ${pairs.length}`);
    assert(pairs[0].arg === baseObj, "first mapped arg should be invoke base (implicit this)");
    assert(pairs[0].paramIndex === 0, "first pair should target parameter index 0");
    assert(pairs[1].arg === taintArg, "second mapped arg should be explicit arg0");
    assert(pairs[1].paramIndex === 1, "second pair should target parameter index 1");
}

function testOwnerInferenceFromBaseType(): void {
    const methodA = {
        getName: () => "foo",
        getCfg: () => ({ getStmts: () => [] }),
        getSignature: () => ({ toString: () => "<@X: A.foo()>" }),
    };
    const methodB = {
        getName: () => "foo",
        getCfg: () => ({ getStmts: () => [] }),
        getSignature: () => ({ toString: () => "<@X: B.foo()>" }),
    };
    const scene: any = {
        getMethods: () => [methodA, methodB],
    };

    const invokeExpr: any = {
        getMethodSignature: () => ({
            toString: () => "<@X: %unk.foo()>",
            getMethodSubSignature: () => ({
                getMethodName: () => "foo",
            }),
        }),
        getArgs: () => [],
        getBase: () => ({
            getType: () => ({
                getClassSignature: () => ({
                    toString: () => "B",
                }),
            }),
        }),
    };

    const candidates = resolveCalleeCandidates(scene, invokeExpr);
    assert(candidates.length === 1, `owner inference expected 1 candidate, got ${candidates.length}`);
    const selectedSig = candidates[0].method.getSignature().toString();
    assert(selectedSig.includes("B.foo"), `owner inference selected unexpected method: ${selectedSig}`);
}

function testDirectCallableTypeFallback(): void {
    const targetMethod = {
        getName: () => "target",
        getCfg: () => ({ getStmts: () => [] }),
        getSignature: () => ({ toString: () => "<@X: Demo.target(string)>" }),
    };
    const scene: any = {
        getMethods: () => [targetMethod],
    };

    const callableType = {
        getMethodSignature: () => ({
            toString: () => "<@X: Demo.target(string)>",
        }),
        toString: () => "Demo.target(string)",
    };

    const invokeExpr: any = {
        getMethodSignature: () => ({
            toString: () => "<@%unk/%unk: .%unk()>",
            getMethodSubSignature: () => ({
                getMethodName: () => "",
            }),
        }),
        getArgs: () => [],
        getBase: () => ({
            getName: () => "fp",
            getType: () => callableType,
            toString: () => "fp",
        }),
    };

    const candidates = resolveCalleeCandidates(scene, invokeExpr);
    assert(candidates.length === 1, `type fallback expected 1 candidate, got ${candidates.length}`);
    assert(candidates[0].reason === "type_fallback", `type fallback reason mismatch: ${candidates[0].reason}`);
}

function testInvokedParamsTracksFieldRelay(): void {
    const fileSig = new FileSignature("proj", "demo.ts");
    const classSig = new ClassSignature("EmitterLike", fileSig);
    const fieldSig = new FieldSignature("slot", classSig, UnknownType.getInstance(), false);
    const callSubSig = new MethodSubSignature("callableInvoke", [], UnknownType.getInstance(), false);
    const callSig = new MethodSignature(classSig, callSubSig);

    const thisLocal = new Local("this");
    const cbLocal = new Local("%AM_cb", { toString: () => "Function" } as any);
    const cbParamRef = new ArkParameterRef(0, UnknownType.getInstance());
    const paramStmt = new ArkAssignStmt(cbLocal, cbParamRef);
    cbLocal.setDeclaringStmt(paramStmt);

    const storeStmt = new ArkAssignStmt(new ArkInstanceFieldRef(thisLocal, fieldSig), cbLocal);

    const loadedLocal = new Local("%AM_loaded", { toString: () => "Function" } as any);
    const loadStmt = new ArkAssignStmt(loadedLocal, new ArkInstanceFieldRef(thisLocal, fieldSig));
    loadedLocal.setDeclaringStmt(loadStmt);
    const invokeStmt = new ArkInvokeStmt(new ArkInstanceInvokeExpr(loadedLocal, callSig, []));

    const registerCfg: any = { getStmts: () => [paramStmt, storeStmt] };
    const emitCfg: any = { getStmts: () => [loadStmt, invokeStmt] };

    const declaringClass: any = {
        getMethods: () => [registerMethod, emitMethod],
    };
    const registerMethod: any = {
        getCfg: () => registerCfg,
        getDeclaringArkClass: () => declaringClass,
    };
    const emitMethod: any = {
        getCfg: () => emitCfg,
        getDeclaringArkClass: () => declaringClass,
    };

    const invoked = analyzeInvokedParams(registerMethod);
    assert(invoked.has(0), "IP_field should mark callback param stored to this.field then invoked in sibling method");
}

function main(): void {
    testImplicitThisArgMapping();
    testOwnerInferenceFromBaseType();
    testDirectCallableTypeFallback();
    testInvokedParamsTracksFieldRelay();
    console.log("callee_resolver_tests=PASS");
}

try {
    main();
} catch (err) {
    console.error("callee_resolver_tests=FAIL");
    console.error(err);
    process.exitCode = 1;
}
