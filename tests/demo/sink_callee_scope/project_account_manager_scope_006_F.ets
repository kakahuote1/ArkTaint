class ProjectAccountManager {
    createAccount(_name: string): void {
    }

    setCredential(_name: string, _kind: string, _credential: string): void {
    }
}

export function project_account_manager_scope_006_F(input: string): void {
    let taint_src = input;
    const manager = new ProjectAccountManager();
    manager.createAccount(taint_src);
    manager.setCredential("user", "password", taint_src);
}
