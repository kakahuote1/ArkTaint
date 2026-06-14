import { buildSemanticFlowPrompt } from "../../core/semanticflow/SemanticFlowPrompt";
import { formatSemanticFlowRuntimeSkills } from "../../core/semanticflow/SemanticFlowRuntimeSkills";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function main(): void {
    const runtimeSkills = formatSemanticFlowRuntimeSkills();
    assert(
        runtimeSkills.includes("Request Payload Endpoint Coverage"),
        "project API modeling skill must contain request payload endpoint coverage guidance",
    );
    assert(
        runtimeSkills.includes("separate sink bindings/templates for `arg0` and `arg1`"),
        "skill must require separate arg0 and arg1 sink endpoints for visible object payload parameters",
    );
    assert(
        runtimeSkills.includes("Do not mark every argument as a sink by default"),
        "skill must forbid broad all-args sink modeling",
    );
    assert(
        runtimeSkills.includes('kind="q_endpoint"'),
        "skill must require q_endpoint when payload endpoint evidence is ambiguous",
    );

    const prompt = buildSemanticFlowPrompt({
        anchor: {
            id: "api-modeling.loginApi",
            surface: "loginApi",
            methodSignature: "@entry/src/main/ets/api/login.ets: loginApi(Unknown, Unknown)",
            filePath: "entry/src/main/ets/api/login.ets",
            metaTags: ["request-wrapper"],
        },
        draftId: "draft.loginApi",
        slice: {
            anchorId: "api-modeling.loginApi",
            round: 1,
            template: "callable-transfer",
            observations: [
                "loginApi is a project HTTP wrapper.",
                "The wrapper constructs params from phone and code before http.post.",
            ],
            snippets: [
                {
                    label: "method-loginApi",
                    code: [
                        "export const loginApi = (phone: string, code: string) => {",
                        "  const params = { phone, code };",
                        "  return http.post('/login', params);",
                        "}",
                    ].join("\n"),
                },
            ],
        },
        round: 1,
        history: [],
    });

    assert(
        prompt.system.includes("requires separate sink endpoints for arg0 and arg1"),
        "main prompt must require endpoint-specific sink coverage for object payload parameters",
    );
    assert(
        prompt.system.includes("Do not mark all arguments as sinks by default"),
        "main prompt must forbid broad all-args request sink generation",
    );
    assert(
        prompt.system.includes('kind="q_endpoint"'),
        "main prompt must request q_endpoint instead of guessing ambiguous payload endpoints",
    );
    assert(
        prompt.user.includes("const params = { phone, code }"),
        "prompt user payload should carry the object payload evidence used by the contract",
    );

    console.log("PASS test_semanticflow_request_payload_endpoint_contract");
}

main();
