import sim from "@ohos.telephony.sim";

function Sink(value: any): void {
    void value;
}

export function telephony_sim_account_001_T(): void {
    sim.getSimAccountInfo(0, (_err, account) => {
        Sink(account);
    });
}
