class HMNavigationOptions {
    homePageUrl: string = "";
}

function HMNavigation(_options: HMNavigationOptions): void {}

@Entry
@Component
struct RootPage {
    build(): void {
        HMNavigation({ homePageUrl: "/login" });
    }
}

@HMRouter({ pageUrl: "/login" })
@Component
struct LoginPage {
    build(): void {
        LoginForm();
    }
}

@Component
struct LoginForm {
    build(): void {}
}

@Component
struct PlainPanel {
    build(): void {}
}

export function route_decorator_page_001(): void {
    RootPage();
}
