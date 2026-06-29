class LifecycleSource {
    static read(): string {
        return "lifecycle";
    }
}

class BuilderSource {
    static read(): string {
        return "builder";
    }
}

class PlainSource {
    static read(): string {
        return "plain";
    }
}

class SyntheticDisplayApi {
    static readDisplay(): string {
        return "display";
    }
}

class SyntheticDisplayUtility {
    static getScreenWidth(): string {
        return SyntheticDisplayApi.readDisplay();
    }
}

class SyntheticCallbackEmitter {
    static once(callback: (payload: string) => void): void {
        callback("event-payload");
    }
}

class SyntheticCallbackRegistrationTask {
    observed: string = "";

    registerOnce(): void {
        SyntheticCallbackEmitter.once((payload: string) => {
            this.observed = payload;
        });
    }
}

class SyntheticTaskApi {
    static request(): string {
        return "task-response";
    }
}

class SyntheticFactoryTask {
    doStart(): string {
        return SyntheticTaskApi.request();
    }
}

class UnreachableApi {
    static read(): string {
        return "unreachable";
    }
}

class UnreachableTask {
    run(): string {
        return UnreachableApi.read();
    }
}

@Entry
@Component
struct DecoratedSourcePage {
    token: string = "";

    aboutToAppear(): void {
        this.token = LifecycleSource.read();
    }

    build(): void {
        this.SearchPanel();
    }

    @Builder
    SearchPanel(): void {
        this.token = BuilderSource.read();
        const items: number[] = [1];
        items.forEach((item: number) => {
            this.token = "carrier";
        });
    }
}

class PlainPanel {
    build(): void {
        const token = PlainSource.read();
    }
}

export function decorator_component_reachability_001(): void {
    const page = new DecoratedSourcePage();
    page.build();
    const plain = new PlainPanel();
    plain.build();
}
