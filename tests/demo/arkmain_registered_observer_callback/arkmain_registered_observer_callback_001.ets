import { ApplicationContext, Caller, UIAbility } from "./taint_mock";

class DemoAbility extends UIAbility {
    onCreate(): void {
        const context = new ApplicationContext();
        context.on("abilityLifecycle", {
            onNewWant: (_ability: UIAbility) => {
                this.handleNewWant();
            },
            onWindowStageCreate: () => {
                this.handleWindowStageCreate();
            },
            onWindowStageDestroy: () => {
                this.handleWindowStageDestroy();
            },
            onWindowStageRestore: () => {
                this.handleWindowStageRestore();
            },
            onWindowStageWillDestroy: () => {
                this.handleWindowStageWillDestroy();
            },
        });
        context.on("environment", {
            onMemoryLevel: (_level: number) => {
                this.handleMemoryLevel();
            },
        });
        context.off("abilityLifecycle", 1, () => {
            this.handleOffAbilityLifecycle();
        });

        const caller = new Caller();
        caller.onRelease((_msg: string) => {
            this.handleCallerOnRelease();
        });
        caller.on("release", (_msg: string) => {
            this.handleCallerReleaseEvent();
        });
        caller.off("release", (_msg: string) => {
            this.handleCallerOffRelease();
        });
    }

    handleNewWant(): void {}
    handleWindowStageCreate(): void {}
    handleWindowStageDestroy(): void {}
    handleWindowStageRestore(): void {}
    handleWindowStageWillDestroy(): void {}
    handleMemoryLevel(): void {}
    handleCallerOnRelease(): void {}
    handleCallerReleaseEvent(): void {}
    handleOffAbilityLifecycle(): void {}
    handleCallerOffRelease(): void {}
}

export function arkmain_registered_observer_callback_001(): void {
    const ability = new DemoAbility();
    ability.onCreate();
}
