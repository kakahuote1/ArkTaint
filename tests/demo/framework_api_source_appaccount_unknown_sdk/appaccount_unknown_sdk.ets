import appAccount from '@ohos.account.appAccount';
import { localAppAccount } from './local_helpers';

function Sink(_value: unknown): void {}

export function appaccount_unknown_sdk_getCredential_001_T(): void {
    const manager = appAccount.createAppAccountManager();
    const credential = manager.getCredential('alice', 'password');
    Sink(credential);
}

export function appaccount_unknown_sdk_getCredential_002_F(): void {
    const manager = localAppAccount.createAppAccountManager();
    const credential = manager.getCredential('alice', 'password');
    Sink(credential);
}
