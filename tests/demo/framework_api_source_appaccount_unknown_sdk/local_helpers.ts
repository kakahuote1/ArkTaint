export const localAppAccount = {
    createAppAccountManager(): { getCredential(name: string, credentialType: string): string } {
        return {
            getCredential(_name: string, _credentialType: string): string {
                return "safe-credential";
            },
        };
    },
};
