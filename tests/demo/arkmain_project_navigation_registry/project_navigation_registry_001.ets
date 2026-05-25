function wrapBuilder(builder: () => void): { builder: () => void } {
    return { builder };
}

class RouteBuild {
    static register(_name: string, _builder: { builder: () => void }): void {}

    static getBuilder(_name: string): { builder: () => void } {
        return wrapBuilder(LoginNav);
    }
}

class EventBus {
    static register(_name: string, _builder: { builder: () => void }): void {}
}

class NavigationHost {
    PagesMap(name: string): void {
        RouteBuild.getBuilder(name).builder();
    }

    build(): void {
        const navigation = new Navigation();
        navigation.navDestination(this.PagesMap);
    }
}

class Navigation {
    navDestination(_builder: (name: string) => void): void {}
}

@Entry
@Component
struct RootPage {
    build(): void {
        new NavigationHost().build();
    }
}

class LoginPage {
    build(): void {}
}

function LoginNav(): void {
    LoginPage();
}

class NoisePage {
    build(): void {}
}

function NoiseNav(): void {
    NoisePage();
}

class AuthGraph {
    static register(): void {
        const loginBuilder = wrapBuilder(LoginNav);
        RouteBuild.register("login", loginBuilder);
    }
}

class NoiseGraph {
    static register(): void {
        const noiseBuilder = wrapBuilder(NoiseNav);
        EventBus.register("login", noiseBuilder);
    }
}

export function project_navigation_registry_001(): void {
    AuthGraph.register();
    NoiseGraph.register();
    new NavigationHost().build();
}
