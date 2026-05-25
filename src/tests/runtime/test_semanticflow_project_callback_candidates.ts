import * as fs from "fs";
import * as path from "path";
import { enrichNoCandidateItemsWithCallsiteSlices } from "../../core/model/callsite/callsiteContextSlices";
import { buildSemanticFlowRuleCandidateItem } from "../../core/semanticflow/SemanticFlowAdapters";
import {
    discoverProjectApiWrapperRuleCandidates,
    discoverProjectCallbackRuleCandidates,
} from "../../core/semanticflow/ProjectCallbackCandidateScanner";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function writeFile(filePath: string, lines: string[]): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf-8");
}

function main(): void {
    const root = path.resolve("tmp/test_runs/runtime/semanticflow_project_callback_candidates/latest");
    const sourceDir = "entry/src/main/ets";
    fs.rmSync(root, { recursive: true, force: true });

    writeFile(path.join(root, sourceDir, "component/PhoneInputField.ets"), [
        "import { IBestField } from 'ibestui';",
        "export struct PhoneInputField {",
        "  onPhoneChange: (value: string) => void = () => {};",
        "  build() {",
        "    IBestField({",
        "      value: '',",
        "      onChange: (value: string): void => {",
        "        this.onPhoneChange(`${value ?? ''}`);",
        "      }",
        "    });",
        "  }",
        "}",
    ]);
    writeFile(path.join(root, sourceDir, "view/LoginPage.ets"), [
        "import { IBestButton, IBestField } from 'ibestui';",
        "import { PhoneInputField } from '../component/PhoneInputField';",
        "export struct LoginPage {",
        "  build() {",
        "    TextInput({ text: '', onChange: (value: string) => this.ignore(value) });",
        "    IBestField({ value: '', onChange: (value: string) => this.vm.updateAccount(value) });",
        "    PhoneInputField({ onPhoneChange: (value: string) => this.vm.updatePhone(value) });",
        "    IBestButton({ text: 'login', onBtnClick: (): void => this.vm.login() });",
        "  }",
        "}",
    ]);
    writeFile(path.join(root, sourceDir, "configure/service.ets"), [
        "import Axios from '@ohos/axios';",
        "export class Servicer {",
        "  static async getUserCredential(code: string) {",
        "    const response = await Axios.post('https://oauth.example/token', { code });",
        "    return response.data;",
        "  }",
        "  static async getUserProfile(token: string) {",
        "    const response = await Axios.post('https://account.example/profile', { access_token: token });",
        "    return response.data;",
        "  }",
        "}",
    ]);
    writeFile(path.join(root, sourceDir, "configure/axios.ets"), [
        "import axios from '@ohos/axios';",
        "export function setupInterceptors(cacher: any) {",
        "  axios.interceptors.response.use((response: any) => {",
        "    cacher.cache(response);",
        "    return response.data;",
        "  }, (error: any) => {",
        "    cacher.logger(error);",
        "    return Promise.reject(error);",
        "  });",
        "}",
    ]);
    writeFile(path.join(root, sourceDir, "database/app.ets"), [
        "import relationalStore from '@ohos.data.relationalStore';",
        "export interface IUser { uid?: string; name?: string | null }",
        "export class AppDatabaser {",
        "  static async updateUser(user?: IUser | null): Promise<IUser | null> {",
        "    const transaction = await db.createTransaction();",
        "    await transaction.execute('update AppUser set name = ? where uid = ?', [user?.name, user?.uid]);",
        "    return user ?? null;",
        "  }",
        "}",
    ]);
    writeFile(path.join(root, sourceDir, "models/user.ets"), [
        "export interface IUser { uid?: string; name?: string | null; email?: string | null }",
        "export class User implements IUser {",
        "  uid: string = '';",
        "  name: string = '';",
        "  email: string = '';",
        "  static from(json: Partial<IUser>) {",
        "    const instance = new User();",
        "    instance.uid = json?.uid ?? '';",
        "    instance.name = json?.name ?? '';",
        "    instance.email = json?.email ?? '';",
        "    return instance;",
        "  }",
        "  public from(json: Partial<IUser>) {",
        "    const instance = new User();",
        "    instance.uid = json?.uid ?? this.uid;",
        "    instance.name = json?.name ?? this.name;",
        "    instance.email = json?.email ?? this.email;",
        "    return instance;",
        "  }",
        "}",
    ]);
    writeFile(path.join(root, sourceDir, "pages/RegisterPage.ets"), [
        "export struct RegisterPage {",
        "  checkPhone() { return true; }",
        "  backRouteBuilder() { return undefined; }",
        "}",
    ]);

    const candidates = discoverProjectCallbackRuleCandidates(root, [sourceDir], {
        maxCandidates: 20,
    });
    const methods = new Set(candidates.map(item => item.method));
    assert(methods.has("IBestField"), "third-party field callback should become a proactive modeling candidate");
    assert(methods.has("PhoneInputField"), "project wrapper callback should become a proactive modeling candidate");
    assert(methods.has("IBestButton"), "third-party action callback should become a proactive modeling candidate");
    assert(!methods.has("TextInput"), "official ArkUI TextInput callback should not be sent to project LLM modeling");

    const phoneCandidate = candidates.find(item => item.method === "PhoneInputField");
    assert(phoneCandidate, "missing PhoneInputField candidate");
    assert(String(phoneCandidate.sourceFile).endsWith("component/PhoneInputField.ets"), `project component candidate should resolve callee source file, got ${phoneCandidate.sourceFile}`);
    assert(Array.isArray((phoneCandidate as any).contextSlices) && (phoneCandidate as any).contextSlices.length > 0, "proactive candidates should include source callsite slices");

    const enriched = enrichNoCandidateItemsWithCallsiteSlices({
        repoRoot: root,
        sourceDirs: [sourceDir],
        items: [phoneCandidate],
        maxItems: 1,
        maxExamplesPerItem: 1,
        contextRadius: 2,
        cfgNeighborRadius: 1,
    });
    assert(Array.isArray((enriched[0] as any).contextSlices) && (enriched[0] as any).contextSlices.length > 0, "enrichment should preserve proactive context slices");

    const item = buildSemanticFlowRuleCandidateItem(enriched[0]);
    assert(item.initialSlice.observations.includes("candidateOrigin=proactive_project_callback_surface"), "prompt observations should expose proactive origin");
    assert(item.initialSlice.observations.some(line => line.includes("callbackProperties=onPhoneChange")), "prompt observations should expose callback property names");

    const methodCallbackCandidate = candidates.find(item =>
        item.method === "use"
        && (item as any).candidateOrigin === "proactive_project_method_callback_surface"
        && String(item.sourceFile).endsWith("configure/axios.ets"));
    assert(methodCallbackCandidate, "third-party method-style callback registration should become a proactive modeling candidate");
    assert((methodCallbackCandidate as any).callbackArgIndexes?.includes(0), "method-style callback candidate should expose callback argument index 0");
    assert((methodCallbackCandidate as any).callbackArgIndexes?.includes(1), "method-style callback candidate should expose callback argument index 1");
    assert((methodCallbackCandidate as any).typeHint === "interceptors.response", `method-style callback candidate should carry a stable receiver-specific typeHint, got ${(methodCallbackCandidate as any).typeHint}`);
    const methodCallbackItem = buildSemanticFlowRuleCandidateItem(methodCallbackCandidate);
    assert(methodCallbackItem.initialSlice.observations.some(line => line.includes("callbackArgIndexes=0,1")), "prompt observations should expose method callback argument indexes");
    assert(methodCallbackItem.initialSlice.observations.some(line => line.includes("typeHint=interceptors.response")), "prompt observations should expose method callback type hint");

    const apiCandidates = discoverProjectApiWrapperRuleCandidates(root, [sourceDir], {
        maxCandidates: 40,
    });
    const apiMethods = new Set(apiCandidates.map(item => item.method));
    assert(apiMethods.has("getUserCredential"), "service wrapper that exchanges auth code through Axios should become a proactive API modeling candidate");
    assert(apiMethods.has("getUserProfile"), "service wrapper that sends access token through Axios should become a proactive API modeling candidate");
    assert(!apiMethods.has("checkPhone"), "page validation helper should not become a proactive API wrapper candidate");
    const credentialCandidate = apiCandidates.find(item =>
        item.method === "getUserCredential" && (item as any).candidateOrigin === "proactive_project_api_wrapper_surface");
    assert(credentialCandidate, "missing getUserCredential proactive API candidate");
    assert((credentialCandidate as any).candidateOrigin === "proactive_project_api_wrapper_surface", "API wrapper candidate should expose proactive API origin");
    assert(typeof (credentialCandidate as any).methodSnippet === "string" && (credentialCandidate as any).methodSnippet.includes("Axios.post"), "API wrapper candidate should carry method body evidence");
    const credentialSourceCandidate = apiCandidates.find(item =>
        item.method === "getUserCredential" && (item as any).semanticFocus === "external_response_source");
    assert(credentialSourceCandidate, "network wrapper that returns response data should also expose a focused return-source candidate");
    const credentialSourceItem = buildSemanticFlowRuleCandidateItem(credentialSourceCandidate);
    assert(credentialSourceItem.initialSlice.observations.includes("semanticFocus=external_response_source"), "focused return-source candidate should expose semanticFocus to the LLM");
    assert((credentialSourceItem.anchor.metaTags || []).includes("focus-external_response_source"), "focused return-source candidate should get a distinct anchor tag");
    assert((credentialSourceItem.initialSlice.notes || []).some(note => note.includes("outputs=[\"ret\"]")), "focused return-source candidate should tell the LLM to model returned response data as ret source");
    const updateUserCandidate = apiCandidates.find(item =>
        item.method === "updateUser" && String(item.sourceFile).endsWith("database/app.ets"));
    assert(updateUserCandidate, "database wrapper with optional parameter should become a proactive API candidate");
    assert(updateUserCandidate.argCount === 1, `optional TypeScript parameter should count as one argument, got ${updateUserCandidate.argCount}`);
    assert(String(updateUserCandidate.callee_signature).includes("updateUser(Unknown)"), `optional parameter should appear in generated signature, got ${updateUserCandidate.callee_signature}`);
    const userFromCandidates = apiCandidates.filter(item =>
        item.method === "from" && String(item.sourceFile).endsWith("models/user.ets"));
    assert(userFromCandidates.length >= 2, `model mapper static/instance from methods should become proactive candidates, got ${userFromCandidates.length}`);
    assert(userFromCandidates.every(item => item.argCount === 1), "model mapper candidates should preserve one payload parameter");

    console.log("PASS test_semanticflow_project_callback_candidates");
}

main();
