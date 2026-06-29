export class UIAbility {}

export class WindowStage {}

export interface AbilityLifecycleCallback {
    onNewWant?: (ability: UIAbility) => void;
    onWindowStageCreate?: (ability: UIAbility, windowStage: WindowStage) => void;
    onWindowStageDestroy?: (ability: UIAbility, windowStage: WindowStage) => void;
    onWindowStageRestore?: (ability: UIAbility, windowStage: WindowStage) => void;
    onWindowStageWillDestroy?: (ability: UIAbility, windowStage: WindowStage) => void;
}

export interface EnvironmentCallback {
    onMemoryLevel?: (level: number) => void;
}

export class ApplicationContext {
    on(type: string, callback: AbilityLifecycleCallback | EnvironmentCallback): number {
        void type;
        void callback;
        return 1;
    }

    off(type: string, callbackId: number, callback?: (err?: Error) => void): void {
        void type;
        void callbackId;
        void callback;
    }
}

export type OnReleaseCallback = (msg: string) => void;

export class Caller {
    onRelease(callback: OnReleaseCallback): void {
        void callback;
    }

    on(type: string, callback: OnReleaseCallback): void {
        void type;
        void callback;
    }

    off(type: string, callback?: OnReleaseCallback): void {
        void type;
        void callback;
    }
}
