function Entry<T extends Function>(_target: T): void {}
function Component<T extends Function>(_target: T): void {}
function State(): any {
    return function (_target: any, _propertyKey: string): void {};
}
function Prop(): any {
    return function (_target: any, _propertyKey: string): void {};
}
function Link(): any {
    return function (_target: any, _propertyKey: string): void {};
}

function Source(): string {
    return "taint";
}

function Sink(_value: string): void {}

class ChildPropCard {
    @Prop()
    title: string = "";

    build(): void {
        const data = Source();
        Sink(data);
    }
}

class ChildLinkCard {
    @Link()
    token: string = "";

    build(): void {
        const data = Source();
        Sink(data);
    }
}

@Entry
@Component
struct DemoPage {
    @State()
    token: string = "";

    build(): void {
        const propCard = new ChildPropCard();
        const linkCard = new ChildLinkCard();
        propCard.title = this.token;
        linkCard.token = this.token;
    }
}

export function state_prop_link_009_T(): void {}
