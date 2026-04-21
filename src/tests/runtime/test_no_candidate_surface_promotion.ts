import { buildNoCandidateCallsiteRecord } from "../../core/kernel/rules/NoCandidateSurface";
import { InvokeSite } from "../../core/kernel/rules/TransferTypes";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function buildSite(overrides: Partial<InvokeSite> = {}): InvokeSite {
    return {
        stmt: {},
        invokeExpr: {} as any,
        signature: "@%unk/%unk: .getParams()",
        methodName: "getParams",
        calleeSignature: "@%unk/%unk: .getParams()",
        calleeMethodName: "getParams",
        calleeFilePath: "%unk/%unk",
        calleeClassText: "@%unk/%unk:",
        calleeClassName: "",
        args: [],
        invokeKind: "instance",
        callerMethodName: "getParams",
        callerSignature: "@ets/router/Router.ets: Router.[static]getParams()",
        callerFilePath: "ets/router/Router.ets",
        callerClassText: "Router",
        ...overrides,
    };
}

function buildOwner(input: {
    code: string;
    invokeMethods: string[];
    isStatic?: boolean;
    paramCount?: number;
}): any {
    return {
        getCode() {
            return input.code;
        },
        getCfg() {
            return {
                getStmts() {
                    return input.invokeMethods.map(method => ({
                        containsInvokeExpr() {
                            return true;
                        },
                        getInvokeExpr() {
                            return {
                                getMethodSignature() {
                                    return {
                                        getMethodSubSignature() {
                                            return {
                                                getMethodName() {
                                                    return method;
                                                },
                                            };
                                        },
                                        toString() {
                                            return `@%unk/%unk: .${method}()`;
                                        },
                                    };
                                },
                            };
                        },
                        getOriginalText() {
                            return method === "getParams"
                                ? "return router.getParams()"
                                : `${method}()`;
                        },
                        toString() {
                            return this.getOriginalText();
                        },
                    }));
                },
            };
        },
        getParameters() {
            return Array.from({ length: input.paramCount || 0 }, (_, index) => ({ index }));
        },
        isStatic() {
            return input.isStatic === true;
        },
    };
}

function main(): void {
    const promoted = buildNoCandidateCallsiteRecord(
        buildSite(),
        buildOwner({
            code: "public static getParams(): Object { return router.getParams() }",
            invokeMethods: ["getParams"],
            isStatic: true,
            paramCount: 0,
        }),
    );
    assert(
        promoted.calleeSignature === "@ets/router/Router.ets: Router.[static]getParams()",
        `expected wrapper promotion to caller signature, got ${promoted.calleeSignature}`,
    );
    assert(promoted.method === "getParams", `expected promoted method name, got ${promoted.method}`);
    assert(promoted.invokeKind === "static", `expected promoted invoke kind static, got ${promoted.invokeKind}`);
    assert(promoted.sourceFile === "ets/router/Router.ets", `expected caller file path, got ${promoted.sourceFile}`);

    const promotedVoidWrapper = buildNoCandidateCallsiteRecord(
        buildSite({
            methodName: "publish",
            calleeMethodName: "publish",
            signature: "@%unk/%unk: .publish(string)",
            calleeSignature: "@%unk/%unk: .publish(string)",
            callerMethodName: "send",
            callerSignature: "@ets/bus/Bus.ets: Bus.send(string)",
            callerFilePath: "ets/bus/Bus.ets",
        }),
        buildOwner({
            code: "public send(value: string) { beacon.publish(value) }",
            invokeMethods: ["publish"],
            isStatic: false,
            paramCount: 1,
        }),
    );
    assert(
        promotedVoidWrapper.calleeSignature === "@ets/bus/Bus.ets: Bus.send(string)",
        `expected direct invoke wrapper promotion, got ${promotedVoidWrapper.calleeSignature}`,
    );
    assert(promotedVoidWrapper.method === "send", `expected caller method send, got ${promotedVoidWrapper.method}`);
    assert(promotedVoidWrapper.invokeKind === "instance", `expected instance wrapper, got ${promotedVoidWrapper.invokeKind}`);
    assert(promotedVoidWrapper.argCount === 1, `expected wrapper argCount=1, got ${promotedVoidWrapper.argCount}`);

    const rawBecauseComplex = buildNoCandidateCallsiteRecord(
        buildSite({
            methodName: "fetchSecret",
            calleeMethodName: "fetchSecret",
            signature: "@%unk/%unk: .fetchSecret()",
            calleeSignature: "@%unk/%unk: .fetchSecret()",
        }),
        buildOwner({
            code: "public fetchSecret(): string { const value = sdk.fetchSecret(); return value + suffix; }",
            invokeMethods: ["fetchSecret"],
            isStatic: false,
            paramCount: 0,
        }),
    );
    assert(
        rawBecauseComplex.calleeSignature === "@%unk/%unk: .fetchSecret()",
        "non-wrapper post-processing must not be promoted to caller surface",
    );

    const rawBecauseMultipleCallees = buildNoCandidateCallsiteRecord(
        buildSite({
            methodName: "fetchSecret",
            calleeMethodName: "fetchSecret",
            signature: "@%unk/%unk: .fetchSecret()",
            calleeSignature: "@%unk/%unk: .fetchSecret()",
        }),
        buildOwner({
            code: "public fetchSecret(): string { const value = sdk.fetchSecret(); audit.log(value); return value; }",
            invokeMethods: ["fetchSecret", "log"],
            isStatic: false,
            paramCount: 0,
        }),
    );
    assert(
        rawBecauseMultipleCallees.calleeSignature === "@%unk/%unk: .fetchSecret()",
        "multi-callee methods must not be promoted to caller surface",
    );

    console.log("PASS test_no_candidate_surface_promotion");
}

try {
    main();
} catch (error) {
    console.error("FAIL test_no_candidate_surface_promotion");
    console.error(error);
    process.exit(1);
}
