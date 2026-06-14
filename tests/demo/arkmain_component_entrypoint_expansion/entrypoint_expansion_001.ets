@Component
struct ChildLifecycleCard {
    aboutToAppear(): void {}

    build(): void {}
}

class PlainLifecycleNames {
    aboutToAppear(): void {}

    build(): void {}
}

@Entry
@Component
struct RootPage {
    build(): void {
        ChildLifecycleCard();
        const plain = new PlainLifecycleNames();
        plain.build();
    }
}

export function entrypoint_expansion_001(): void {
    const page = new RootPage();
    page.build();
}
