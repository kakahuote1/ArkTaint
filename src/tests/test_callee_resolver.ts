import { ArkParameterRef } from "../../arkanalyzer/out/src/core/base/Ref";
import { UnknownType } from "../../arkanalyzer/out/src/core/base/Type";
import { mapInvokeArgsToParamAssigns, resolveCalleeCandidates } from "../core/engine/CalleeResolver";

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

function main(): void {
    testImplicitThisArgMapping();
    testOwnerInferenceFromBaseType();
    console.log("callee_resolver_tests=PASS");
}

try {
    main();
} catch (err) {
    console.error("callee_resolver_tests=FAIL");
    console.error(err);
    process.exitCode = 1;
}
