import {
    UIAbility,
    Want,
    WindowStage,
    UIInput,
    Router,
    AppStorage,
    Watch,
    State,
    Prop,
    Link,
    ObjectLink,
} from "./taint_mock";

function cbOnClick(event: string): void {
    console.log(event);
}

function cbOnChange(value: string): void {
    console.log(value);
}

class ChildPropCard {
    @Prop()
    title: string = "";

    build(): void {}
}

class ChildLinkCard {
    @Link()
    token: string = "";

    build(): void {}
}

class ChildLinkWatchCard {
    @Link()
    token: string = "";

    @Watch("token")
    onLinkedTokenWatch(): void {}
}

class TokenModel {
    token: string = "";
}

class GrandChildObjectLinkCard {
    @ObjectLink()
    model: TokenModel = new TokenModel();

    @Watch("model")
    onModelWatch(): void {}
}

class ReactiveWatchPage {
    @State()
    token: string = "";

    aboutToAppear(): void {}

    @Watch("token")
    onPhaseWatch(): void {}
}

class EntryAbility extends UIAbility {
    onCreate(want: Want): void {}

    onNewWant(want: Want): void {}

    onWindowStageCreate(stage: WindowStage): void {}

    onForeground(): void {}

    onBackground(): void {}

    onWindowStageDestroy(): void {}

    onDestroy(): void {}
}

@Entry
@Component
struct DemoPage {
    @State()
    token: string = "";

    @State()
    model: TokenModel = new TokenModel();

    aboutToAppear(): void {}

    onPageShow(): void {}

    onPageHide(): void {}

    @Watch("token")
    onTokenWatch(): void {}

    hydrateFromRoute(): void {
        const routeParams = Router.getParams();
        const storedToken = AppStorage.get("token");
        this.token = `${routeParams}${storedToken}`;
    }

    build() {
        const input = new UIInput();
        const propCard = new ChildPropCard();
        const linkCard = new ChildLinkCard();
        const linkWatchCard = new ChildLinkWatchCard();
        const objectLinkCard = new GrandChildObjectLinkCard();
        Router.pushUrl({ url: "pages/demo", params: this.token });
        propCard.title = this.token;
        linkCard.token = this.token;
        linkWatchCard.token = this.token;
        objectLinkCard.model = this.model;
        input.onClick(cbOnClick);
        input.onChange(cbOnChange);
        propCard.build();
        linkCard.build();
    }
}

export function arkmain_entry_phases_001(): void {
    const ability = new EntryAbility();
    const want = new Want();
    const stage = new WindowStage();
    const page = new DemoPage();
    const reactivePage = new ReactiveWatchPage();
    ability.onCreate(want);
    ability.onWindowStageCreate(stage);
    ability.onForeground();
    reactivePage.aboutToAppear();
    page.aboutToAppear();
    page.onPageShow();
    page.hydrateFromRoute();
    page.build();
    ability.onNewWant(want);
    page.onPageHide();
    ability.onBackground();
    ability.onWindowStageDestroy();
    ability.onDestroy();
}
