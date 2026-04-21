// === Framework base classes ===

export class Want {
    parameters: any = {};
    constructor(params?: any) {
        if (params) this.parameters = params;
    }
}

export class AbilityContext {
    startAbility(want: Want): void { void want; }
    startAbilityForResult(want: Want): void { void want; }
}

export class UIAbility {
    context: AbilityContext = new AbilityContext();
}

export class AbilityStage {}

export class FormExtensionAbility {}

export class FormBindingData {
    payload: string = "";
}

export class ServiceExtensionAbility {}

export class UIExtensionAbility {}

export class InputMethodExtensionAbility {}

export class WorkSchedulerExtensionAbility {}

export class BackupExtensionAbility {}

export class WindowStage {
    loadContent(url: string, callback?: (err: any) => void): void {
        void url;
        void callback;
    }
}

// === UI base classes ===

export class Button {
    onClick(cb: (event: any) => void): Button { void cb; return this; }
    onTouch(cb: (event: any) => void): Button { void cb; return this; }
    onAppear(cb: () => void): Button { void cb; return this; }
    onHover(cb: (isHover: boolean) => void): Button { void cb; return this; }
    onFocus(cb: () => void): Button { void cb; return this; }
    onBlur(cb: () => void): Button { void cb; return this; }
}

export class TextInput {
    onChange(cb: (value: string) => void): TextInput { void cb; return this; }
    onSubmit(cb: (enterKey: number) => void): TextInput { void cb; return this; }
    onFocus(cb: () => void): TextInput { void cb; return this; }
}

export class List {
    onScroll(cb: (offset: number, state: number) => void): List { void cb; return this; }
    onScrollIndex(cb: (start: number, end: number) => void): List { void cb; return this; }
    onReachStart(cb: () => void): List { void cb; return this; }
    onReachEnd(cb: () => void): List { void cb; return this; }
}

export class Slider {
    onChange(cb: (value: number, mode: number) => void): Slider { void cb; return this; }
}

export class Toggle {
    onChange(cb: (isOn: boolean) => void): Toggle { void cb; return this; }
}

export class Search {
    onSubmit(cb: (value: string) => void): Search { void cb; return this; }
    onChange(cb: (value: string) => void): Search { void cb; return this; }
}

export class Swiper {
    onChange(cb: (index: number) => void): Swiper { void cb; return this; }
    onAnimationStart(cb: (index: number) => void): Swiper { void cb; return this; }
    onAnimationEnd(cb: (index: number) => void): Swiper { void cb; return this; }
}

export class Tabs {
    onChange(cb: (index: number) => void): Tabs { void cb; return this; }
    onTabBarClick(cb: (index: number) => void): Tabs { void cb; return this; }
}

export class Web {
    onPageBegin(cb: (event: { url: string }) => void): Web { void cb; return this; }
    onPageEnd(cb: (event: { url: string }) => void): Web { void cb; return this; }
    onErrorReceive(cb: (event: any) => void): Web { void cb; return this; }
}

export class WebView {
    onMessage(cb: (msg: string) => void): void { void cb; }
    runJavaScript(script: string): void { void script; }
}

// === Gesture system ===

export class TapGesture {
    onAction(cb: (event: any) => void): TapGesture { void cb; return this; }
}

export class LongPressGesture {
    onAction(cb: (event: any) => void): LongPressGesture { void cb; return this; }
    onActionEnd(cb: (event: any) => void): LongPressGesture { void cb; return this; }
}

export class PanGesture {
    onActionStart(cb: (event: any) => void): PanGesture { void cb; return this; }
    onActionUpdate(cb: (event: any) => void): PanGesture { void cb; return this; }
    onActionEnd(cb: (event: any) => void): PanGesture { void cb; return this; }
}

export class PinchGesture {
    onActionStart(cb: (event: any) => void): PinchGesture { void cb; return this; }
    onActionUpdate(cb: (event: any) => void): PinchGesture { void cb; return this; }
    onActionEnd(cb: (event: any) => void): PinchGesture { void cb; return this; }
}

export class SwipeGesture {
    onAction(cb: (event: any) => void): SwipeGesture { void cb; return this; }
}

// === Navigation ===

export class Router {
    static pushUrl(options: { url: string; params?: any }): void { void options; }
    static replaceUrl(options: { url: string; params?: any }): void { void options; }
    static pushNamedRoute(options: { name: string; params?: any }): void { void options; }
    static getParams(): any { return {}; }
    static back(): void {}
}

export class NavPathStack {
    pushPath(info: { name: string; param?: any }): void { void info; }
    pushPathByName(name: string, param?: any): void { void name; void param; }
    replacePath(info: { name: string; param?: any }): void { void info; }
    pop(): void {}
    getParamByName(name: string): any { void name; return {}; }
}

export class NavDestination {
    register(name: string, builder: () => void): void { void name; void builder; }
}

// === Async / System ===

export class Worker {
    onMessage(cb: (msg: any) => void): void { void cb; }
    postMessage(msg: any): void { void msg; }
    onError(cb: (err: any) => void): void { void cb; }
    terminate(): void {}
}

export class TaskPool {
    static execute(task: (...args: any[]) => any, ...args: any[]): void { void task; void args; }
}

export class Emitter {
    static on(eventId: string, cb: (data: any) => void): void { void eventId; void cb; }
    static off(eventId: string, cb?: (data: any) => void): void { void eventId; void cb; }
    static emit(eventId: string, data?: any): void { void eventId; void data; }
}

export class EventHub {
    on(event: string, cb: (...args: any[]) => void): void { void event; void cb; }
    off(event: string, cb?: (...args: any[]) => void): void { void event; void cb; }
    emit(event: string, ...args: any[]): void { void event; void args; }
}

// === Data / Storage ===

export class AppStorage {
    static setOrCreate(key: string, value: any): void { void key; void value; }
    static get(key: string): any { void key; return ""; }
    static link(key: string): any { void key; return ""; }
}

export class KVStore {
    put(key: string, value: any): void { void key; void value; }
    get(key: string): any { void key; return ""; }
    on(event: string, cb: (data: any) => void): void { void event; void cb; }
}

export class Preferences {
    get(key: string, defaultValue: any, cb: (err: any, value: any) => void): void {
        void key; void defaultValue; void cb;
    }
    put(key: string, value: any, cb?: (err: any) => void): void {
        void key; void value; void cb;
    }
}

// === HTTP ===

export class HttpRequest {
    request(url: string, cb: (err: any, data: any) => void): void { void url; void cb; }
}

export function createHttp(): HttpRequest {
    return new HttpRequest();
}

// === Media ===

export class MediaQueryListener {
    on(type: string, cb: (result: any) => void): void { void type; void cb; }
}

export function matchMediaSync(condition: string): MediaQueryListener {
    void condition;
    return new MediaQueryListener();
}

// === Custom Dialog ===

export interface CustomDialogControllerOptions {
    builder: () => void;
    cancel?: () => void;
    confirm?: () => void;
    autoCancel?: boolean;
}

export class CustomDialogController {
    private options: CustomDialogControllerOptions;
    constructor(options: CustomDialogControllerOptions) {
        this.options = options;
    }
    open(): void {}
    close(): void {}
}

// === Animation ===

export function animateTo(params: { duration: number; onFinish?: () => void }, cb: () => void): void {
    void params;
    void cb;
}

// === Common Event ===

export class CommonEventSubscriber {
    static subscribe(info: { events: string[] }, cb: (err: any, data: any) => void): void {
        void info; void cb;
    }
}

// === LazyForEach support ===

export interface IDataSource {
    totalCount(): number;
    getData(index: number): any;
    registerDataChangeListener?(listener: any): void;
    unregisterDataChangeListener?(listener: any): void;
}

// === Drag & Drop ===

export class DragEvent {
    getData(): string { return ""; }
    getSummary(): string { return ""; }
}

// === Pickers ===

export class DatePicker {
    onChange(cb: (value: { year: number; month: number; day: number }) => void): DatePicker { void cb; return this; }
}

export class TimePicker {
    onChange(cb: (value: { hour: number; minute: number }) => void): TimePicker { void cb; return this; }
}

export class TextPicker {
    onChange(cb: (value: string, index: number) => void): TextPicker { void cb; return this; }
}

export class Select {
    onSelect(cb: (index: number, value: string) => void): Select { void cb; return this; }
}

// === Video / XComponent ===

export class Video {
    onStart(cb: () => void): Video { void cb; return this; }
    onPause(cb: () => void): Video { void cb; return this; }
    onFinish(cb: () => void): Video { void cb; return this; }
    onError(cb: () => void): Video { void cb; return this; }
    onPrepared(cb: (event: { duration: number }) => void): Video { void cb; return this; }
    onSeeking(cb: (event: { time: number }) => void): Video { void cb; return this; }
    onUpdate(cb: (event: { time: number }) => void): Video { void cb; return this; }
}

export class XComponent {
    onLoad(cb: (context: any) => void): XComponent { void cb; return this; }
    onDestroy(cb: () => void): XComponent { void cb; return this; }
}

// === Refresh / Grid / WaterFlow ===

export class Refresh {
    onRefreshing(cb: () => void): Refresh { void cb; return this; }
    onStateChange(cb: (state: number) => void): Refresh { void cb; return this; }
}

export class Grid {
    onScrollIndex(cb: (first: number) => void): Grid { void cb; return this; }
    onReachStart(cb: () => void): Grid { void cb; return this; }
    onReachEnd(cb: () => void): Grid { void cb; return this; }
}

export class WaterFlow {
    onReachStart(cb: () => void): WaterFlow { void cb; return this; }
    onReachEnd(cb: () => void): WaterFlow { void cb; return this; }
    onScrollIndex(cb: (first: number, last: number) => void): WaterFlow { void cb; return this; }
}

// === Canvas ===

export class CanvasRenderingContext2D {
    fillRect(x: number, y: number, w: number, h: number): void { void x; void y; void w; void h; }
    fillText(text: string, x: number, y: number): void { void text; void x; void y; }
    drawImage(image: any, x: number, y: number): void { void image; void x; void y; }
}

export class Canvas {
    onReady(cb: () => void): Canvas { void cb; return this; }
}

// === AlertDialog / ActionSheet ===

export class AlertDialog {
    static show(options: {
        title?: string;
        message?: string;
        primaryButton?: { value: string; action: () => void };
        secondaryButton?: { value: string; action: () => void };
        cancel?: () => void;
    }): void { void options; }
}

export class ActionSheet {
    static show(options: {
        title?: string;
        sheets: Array<{ title: string; action: () => void }>;
        cancel?: () => void;
    }): void { void options; }
}

// === RichEditor ===

export class RichEditor {
    onReady(cb: () => void): RichEditor { void cb; return this; }
    onSelect(cb: (value: { start: number; end: number }) => void): RichEditor { void cb; return this; }
    aboutToIMEInput(cb: (value: any) => boolean): RichEditor { void cb; return this; }
    onIMEInputComplete(cb: (value: any) => void): RichEditor { void cb; return this; }
    aboutToDelete(cb: (value: any) => boolean): RichEditor { void cb; return this; }
    onDeleteComplete(cb: () => void): RichEditor { void cb; return this; }
    onPaste(cb: () => void): RichEditor { void cb; return this; }
}

// === Geolocation / Sensor ===

export class Geolocation {
    static on(type: string, request: any, cb: (location: { latitude: number; longitude: number }) => void): void {
        void type; void request; void cb;
    }
    static off(type: string): void { void type; }
}

export class Sensor {
    static on(sensorId: number, cb: (data: any) => void, options?: any): void {
        void sensorId; void cb; void options;
    }
    static off(sensorId: number): void { void sensorId; }
}

// === DataShare ===

export class DataShareExtensionAbility {}

// === LocalStorage ===

export class LocalStorage {
    constructor(initData?: Record<string, any>) { void initData; }
    get(key: string): any { void key; return ""; }
    set(key: string, value: any): void { void key; void value; }
    link(key: string): any { void key; return ""; }
    prop(key: string): any { void key; return ""; }
}

// === Notification ===

export class NotificationManager {
    static subscribe(subscriber: any, cb: (err: any, data: any) => void): void {
        void subscriber; void cb;
    }
}

// === Taint API ===

export namespace taint {
    export function Source(): string {
        return "tainted_realworld_source";
    }
    export function Sink(value: any): void {
        void value;
    }
}
