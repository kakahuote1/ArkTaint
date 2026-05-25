import appAccount from "@ohos.account.appAccount";

export function appaccount_manager_sdk_scope_005_T(input: string): void {
    let taint_src = input;
    const manager = appAccount.createAppAccountManager();
    manager.createAccount(taint_src);
    manager.setCredential("user", "password", taint_src);
}
