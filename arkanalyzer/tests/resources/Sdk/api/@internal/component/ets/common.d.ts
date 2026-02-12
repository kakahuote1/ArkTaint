/*
 * Copyright (c) 2024-2025 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

declare interface ComponentOptions {


    freezeWhenInactive: boolean,
}


declare interface InputCounterOptions {


    thresholdPercentage?: number;


    highlightBorder?: boolean;
}


declare interface TextDecorationOptions {

    type: TextDecorationType;


    color?: ResourceColor;


    style?: TextDecorationStyle;
}


declare const Component: ClassDecorator & ((options: ComponentOptions) => ClassDecorator);


declare const ComponentV2: ClassDecorator & ((options: ComponentOptions) => ClassDecorator);


declare interface EntryOptions {


    routeName?: string,


    storage?: LocalStorage,


    useSharedStorage?: boolean,
}


declare const Entry: ClassDecorator & ((options?: LocalStorage | EntryOptions) => ClassDecorator);


declare const Observed: ClassDecorator;


declare const ObservedV2: ClassDecorator;


declare const Preview: ClassDecorator & ((value: PreviewParams) => ClassDecorator);


declare const Require: PropertyDecorator;


declare const BuilderParam: PropertyDecorator;


declare const Local: PropertyDecorator;


declare const Param: PropertyDecorator;


declare const Once: PropertyDecorator;


declare const Event: PropertyDecorator;


declare const State: PropertyDecorator;


declare const Track: PropertyDecorator;


declare const Trace: PropertyDecorator;


declare const Prop: PropertyDecorator;


declare const Link: PropertyDecorator;


declare const ObjectLink: PropertyDecorator;


declare interface ProvideOptions {

    allowOverride?: string,
}


declare const Provide: PropertyDecorator & ((value: string | ProvideOptions) => PropertyDecorator);


declare const Provider: (aliasName?: string) => PropertyDecorator;


declare const Consume: PropertyDecorator & ((value: string) => PropertyDecorator);


declare const Consumer: (aliasName?: string) => PropertyDecorator;


declare const Computed: MethodDecorator;


declare const StorageProp: (value: string) => PropertyDecorator;


declare const StorageLink: (value: string) => PropertyDecorator;


declare const Watch: (value: string) => PropertyDecorator;


declare const Builder: MethodDecorator;


declare const LocalBuilder: MethodDecorator;


declare const Styles: MethodDecorator;


declare const Extend: MethodDecorator & ((value: any) => MethodDecorator);


declare const AnimatableExtend: MethodDecorator & ((value: Object) => MethodDecorator);


declare const Monitor: MonitorDecorator;


declare type MonitorDecorator = (value: string, ...args: string[]) => MethodDecorator;


declare interface IMonitor {

    dirty: Array<string>;


    value<T>(path?: string): IMonitorValue<T> | undefined;
}


declare interface IMonitorValue<T> {

    before: T;


    now: T;


    path: string;
}


declare interface AnimatableArithmetic<T> {


    plus(rhs: AnimatableArithmetic<T>): AnimatableArithmetic<T>;


    subtract(rhs: AnimatableArithmetic<T>): AnimatableArithmetic<T>;


    multiply(scale: number): AnimatableArithmetic<T>;


    equals(rhs: AnimatableArithmetic<T>): boolean;
}


declare const Concurrent: MethodDecorator;


declare const Sendable: ClassDecorator;


declare const CustomDialog: ClassDecorator;


declare const LocalStorageLink: (value: string) => PropertyDecorator;


declare const LocalStorageProp: (value: string) => PropertyDecorator;


declare function getContext(component?: Object): Context;


declare const Reusable: ClassDecorator;


declare type Context = import('../api/application/Context').default;


declare function postCardAction(component: Object, action: Object): void;


declare interface Configuration {


    readonly colorMode: string;


    readonly fontScale: number;
}


declare interface Rectangle {


    x?: Length;


    y?: Length;


    width?: Length;


    height?: Length;
}


declare interface ExpectedFrameRateRange {


    min: number,


    max: number,


    expected: number,
}


declare function $r(value: string, ...params: any[]): Resource;


declare function $rawfile(value: string): Resource;


declare enum FinishCallbackType {


    REMOVED = 0,


    LOGICALLY = 1,
}


declare enum TouchTestStrategy {


    DEFAULT = 0,


    FORWARD_COMPETITION = 1,


    FORWARD = 2
}


declare interface AnimateParam {


    duration?: number;


    tempo?: number;


    curve?: Curve | string | ICurve;


    delay?: number;


    iterations?: number;


    playMode?: PlayMode;


    onFinish?: () => void;


    finishCallbackType?: FinishCallbackType;


    expectedFrameRateRange?: ExpectedFrameRateRange;
}


interface ICurve {


    interpolate(fraction: number): number;
}


declare interface MotionPathOptions {


    path: string;


    from?: number;


    to?: number;


    rotatable?: boolean;
}


declare interface sharedTransitionOptions {


    duration?: number;


    curve?: Curve | string | ICurve;


    delay?: number;


    motionPath?: MotionPathOptions;


    zIndex?: number;


    type?: SharedTransitionEffectType;
}


declare interface GeometryTransitionOptions {


    follow?: boolean;

    hierarchyStrategy?: TransitionHierarchyStrategy
}


declare enum TransitionHierarchyStrategy {

    NONE = 0,


    ADAPTIVE = 1,
}


declare interface TranslateOptions {


    x?: number | string;


    y?: number | string;


    z?: number | string;
}


declare interface ScaleOptions {


    x?: number;


    y?: number;


    z?: number;


    centerX?: number | string;


    centerY?: number | string;
}


declare interface AlignRuleOption {


    left?: { anchor: string, align: HorizontalAlign };


    right?: { anchor: string, align: HorizontalAlign };


    middle?: { anchor: string, align: HorizontalAlign };


    top?: { anchor: string, align: VerticalAlign };


    bottom?: { anchor: string, align: VerticalAlign };


    center?: { anchor: string, align: VerticalAlign };


    bias?: Bias;
}


declare interface LocalizedHorizontalAlignParam {

    anchor: string;


    align: HorizontalAlign;
}


declare interface LocalizedVerticalAlignParam {

    anchor: string;


    align: VerticalAlign;
}


declare interface LocalizedAlignRuleOptions {

    start?: LocalizedHorizontalAlignParam;


    end?: LocalizedHorizontalAlignParam;


    middle?: LocalizedHorizontalAlignParam;


    top?: LocalizedVerticalAlignParam;


    bottom?: LocalizedVerticalAlignParam;


    center?: LocalizedVerticalAlignParam;


    bias?: Bias;
}


declare enum ChainStyle {

    SPREAD,


    SPREAD_INSIDE,


    PACKED,
}


declare interface RotateOptions {


    x?: number;


    y?: number;


    z?: number;


    centerX?: number | string;


    centerY?: number | string;


    centerZ?: number;


    perspective?: number;


    angle: number | string;
}


declare interface TransitionOptions {

    type?: TransitionType;

    opacity?: number;

    translate?: TranslateOptions;

    scale?: ScaleOptions;

    rotate?: RotateOptions;
}


declare enum TransitionEdge {


    TOP,


    BOTTOM,


    START,


    END
}


declare type TransitionEffects = {
    identity: undefined;
    opacity: number;
    slideSwitch: undefined;
    move: TransitionEdge;
    translate: TranslateOptions;
    rotate: RotateOptions;
    scale: ScaleOptions;
    asymmetric: {
        appear: TransitionEffect;
        disappear: TransitionEffect;
    };
};


declare class DrawModifier {

    drawBehind?(drawContext: DrawContext): void;


    drawContent?(drawContext: DrawContext): void;


    drawFront?(drawContext: DrawContext): void;


    invalidate(): void;
}


declare class TransitionEffect<
    Type extends keyof TransitionEffects = keyof TransitionEffects,
    Effect extends TransitionEffects[Type] = TransitionEffects[Type]
> {


    static readonly IDENTITY: TransitionEffect<"identity">;


    static readonly OPACITY: TransitionEffect<"opacity">;


    static readonly SLIDE: TransitionEffect<
        "asymmetric",
        {
            appear: TransitionEffect<"move", TransitionEdge>;
            disappear: TransitionEffect<"move", TransitionEdge>;
        }
    >;


    static readonly SLIDE_SWITCH: TransitionEffect<"slideSwitch">;


    static translate(options: TranslateOptions): TransitionEffect<"translate">;


    static rotate(options: RotateOptions): TransitionEffect<"rotate">;


    static scale(options: ScaleOptions): TransitionEffect<"scale">;


    static opacity(alpha: number): TransitionEffect<"opacity">;


    static move(edge: TransitionEdge): TransitionEffect<"move">;


    static asymmetric(
        appear: TransitionEffect,
        disappear: TransitionEffect
    ): TransitionEffect<"asymmetric">;


    constructor(type: Type, effect: Effect);


    animation(value: AnimateParam): TransitionEffect;


    combine(transitionEffect: TransitionEffect): TransitionEffect;
}


interface PreviewParams {


    title?: string;


    width?: number;


    height?: number;


    locale?: string;


    colorMode?: string;


    deviceType?: string;


    dpi?: number;


    orientation?: string;


    roundScreen?: boolean;
}


declare interface ItemDragInfo {


    x: number;


    y: number;
}


declare enum PreDragStatus {

    ACTION_DETECTING_STATUS = 0,


    READY_TO_TRIGGER_DRAG_ACTION = 1,


    PREVIEW_LIFT_STARTED = 2,


    PREVIEW_LIFT_FINISHED = 3,


    PREVIEW_LANDING_STARTED = 4,


    PREVIEW_LANDING_FINISHED = 5,


    ACTION_CANCELED_BEFORE_DRAG = 6,
}


declare interface DragItemInfo {


    pixelMap?: PixelMap;


    builder?: CustomBuilder;


    extraInfo?: string;
}


declare function animateTo(value: AnimateParam, event: () => void): void;


declare function animateToImmediately(value: AnimateParam, event: () => void): void;


declare function vp2px(value: number): number;


declare function px2vp(value: number): number;


declare function fp2px(value: number): number;


declare function px2fp(value: number): number;


declare function lpx2px(value: number): number;


declare function px2lpx(value: number): number;


declare namespace focusControl {


    function requestFocus(value: string): boolean;
}


declare type PointerStyle = import('../api/@ohos.multimodalInput.pointer').default.PointerStyle;


declare namespace cursorControl {


    function setCursor(value: PointerStyle): void;


    function restoreDefault(): void;
}


declare interface EventTarget {


    area: Area;
}


declare enum SourceType {


    Unknown,


    Mouse,


    TouchScreen,
}


declare enum SourceTool {


    Unknown,


    Finger,


    Pen,


    MOUSE,


    TOUCHPAD,


    JOYSTICK,
}


declare enum RepeatMode {


    Repeat,


    Stretch,


    Round,


    Space,
}


declare enum BlurStyle {


    Thin,


    Regular,


    Thick,


    BACKGROUND_THIN,


    BACKGROUND_REGULAR,


    BACKGROUND_THICK,


    BACKGROUND_ULTRA_THICK,


    NONE,


    COMPONENT_ULTRA_THIN = 8,


    COMPONENT_THIN = 9,


    COMPONENT_REGULAR = 10,


    COMPONENT_THICK = 11,


    COMPONENT_ULTRA_THICK = 12,
}


declare enum BlurStyleActivePolicy {

    FOLLOWS_WINDOW_ACTIVE_STATE = 0,


    ALWAYS_ACTIVE = 1,


    ALWAYS_INACTIVE = 2,
}


declare enum BlurType {

    WITHIN_WINDOW = 0,

    BEHIND_WINDOW = 1
}


declare enum ThemeColorMode {


    SYSTEM,


    LIGHT,


    DARK,
}


declare enum AdaptiveColor {


    DEFAULT,


    AVERAGE,
}


declare enum ModalTransition {


    DEFAULT,


    NONE,


    ALPHA,
}


declare interface BackgroundBlurStyleOptions extends BlurStyleOptions {

    policy?: BlurStyleActivePolicy;


    inactiveColor?: ResourceColor;


    type?: BlurType;
}


declare interface ForegroundBlurStyleOptions extends BlurStyleOptions {
}


declare interface BlurOptions {


    grayscale: [number, number];
}


declare interface BlurStyleOptions {


    colorMode?: ThemeColorMode;


    adaptiveColor?: AdaptiveColor;


    scale?: number;


    blurOptions?: BlurOptions;
}


declare interface BackgroundEffectOptions {


    radius: number;


    saturation?: number;


    brightness?: number;


    color?: ResourceColor;


    adaptiveColor?: AdaptiveColor;


    blurOptions?: BlurOptions;


    policy?: BlurStyleActivePolicy;


    inactiveColor?: ResourceColor;


    type?: BlurType;
}


declare interface ForegroundEffectOptions {


    radius: number;
}


declare interface PickerTextStyle {


    color?: ResourceColor;


    font?: Font;
}


declare interface PickerDialogButtonStyle {

    type?: ButtonType;


    style?: ButtonStyleMode;


    role?: ButtonRole;


    fontSize?: Length;


    fontColor?: ResourceColor;


    fontWeight?: FontWeight | number | string;


    fontStyle?: FontStyle;


    fontFamily?: Resource | string;


    backgroundColor?: ResourceColor;


    borderRadius?: Length | BorderRadiuses;


    primary?: boolean;
}


declare enum ShadowType {


    COLOR,


    BLUR,
}


declare interface ShadowOptions {


    radius: number | Resource;


    type?: ShadowType;


    color?: Color | string | Resource | ColoringStrategy;


    offsetX?: number | Resource;


    offsetY?: number | Resource;


    fill?: boolean;
}


declare enum ShadowStyle {


    OUTER_DEFAULT_XS,


    OUTER_DEFAULT_SM,


    OUTER_DEFAULT_MD,


    OUTER_DEFAULT_LG,


    OUTER_FLOATING_SM,


    OUTER_FLOATING_MD,
}


declare interface MultiShadowOptions {


    radius?: number | Resource;


    offsetX?: number | Resource;


    offsetY?: number | Resource;
}


declare enum SafeAreaType {


    SYSTEM,


    CUTOUT,


    KEYBOARD
}


declare enum SafeAreaEdge {


    TOP,


    BOTTOM,


    START,


    END
}


declare enum LayoutSafeAreaType {

    SYSTEM = 0,
}


declare enum LayoutSafeAreaEdge {

    TOP = 0,


    BOTTOM = 1,
}


declare enum SheetSize {


    MEDIUM,


    LARGE,


    FIT_CONTENT = 2,
}


declare interface BaseEvent {


    target: EventTarget;


    timestamp: number;


    source: SourceType;


    axisHorizontal?: number;


    axisVertical?: number;


    pressure: number;


    tiltX: number;


    tiltY: number;


    sourceTool: SourceTool;


    getModifierKeyState?(keys: Array<string>): boolean;


    deviceId?: number;
}


declare interface BorderImageOption {


    slice?: Length | EdgeWidths | LocalizedEdgeWidths,


    repeat?: RepeatMode,


    source?: string | Resource | LinearGradient,


    width?: Length | EdgeWidths | LocalizedEdgeWidths,


    outset?: Length | EdgeWidths | LocalizedEdgeWidths,


    fill?: boolean
}


declare interface ClickEvent extends BaseEvent {


    displayX: number;


    displayY: number;


    windowX: number;


    windowY: number;


    screenX: number;


    screenY: number;


    x: number;


    y: number;


    preventDefault: () => void;
}


declare interface HoverEvent extends BaseEvent {


    stopPropagation: () => void;
}


declare interface MouseEvent extends BaseEvent {


    button: MouseButton;


    action: MouseAction;


    displayX: number;


    displayY: number;


    windowX: number;


    windowY: number;


    screenX: number;


    screenY: number;


    x: number;


    y: number;


    stopPropagation: () => void;
}


declare interface AccessibilityHoverEvent extends BaseEvent {

    type: AccessibilityHoverType;


    x: number;


    y: number;


    displayX: number;


    displayY: number;


    windowX: number;


    windowY: number;
}


declare interface TouchObject {


    type: TouchType;


    id: number;


    displayX: number;


    displayY: number;


    windowX: number;


    windowY: number;


    screenX: number;


    screenY: number;


    x: number;


    y: number;
}


declare interface HistoricalPoint {


    touchObject: TouchObject;


    size: number;


    force: number;


    timestamp: number;
}


declare interface TouchEvent extends BaseEvent {


    type: TouchType;


    touches: TouchObject[];


    changedTouches: TouchObject[];


    stopPropagation: () => void;


    getHistoricalPoints(): Array<HistoricalPoint>;


    preventDefault: () => void;
}


declare type SizeChangeCallback = (oldValue: SizeOptions, newValue: SizeOptions) => void;


declare type GestureRecognizerJudgeBeginCallback = (event: BaseGestureEvent, current: GestureRecognizer, recognizers: Array<GestureRecognizer>) => GestureJudgeResult;


declare type ShouldBuiltInRecognizerParallelWithCallback = (current: GestureRecognizer, others: Array<GestureRecognizer>) => GestureRecognizer;


declare type TransitionFinishCallback = (transitionIn: boolean) => void;


declare type PixelMap = import('./@ohos.multimedia.image').default.PixelMap;


declare interface PixelMapMock {

    release(): void;
}


declare enum DragBehavior {


    COPY,


    MOVE
}


declare type UnifiedData = import('../api/@ohos.data.unifiedDataChannel').default.UnifiedData;


declare type Summary = import('../api/@ohos.data.unifiedDataChannel').default.Summary;


declare type UniformDataType = import('../api/@ohos.data.uniformTypeDescriptor').default.UniformDataType;


declare enum DragResult {


    DRAG_SUCCESSFUL = 0,


    DRAG_FAILED = 1,


    DRAG_CANCELED = 2,


    DROP_ENABLED = 3,


    DROP_DISABLED = 4
}


declare enum BlendMode {


    NONE = 0,


    CLEAR = 1,


    SRC = 2,


    DST = 3,


    SRC_OVER = 4,


    DST_OVER = 5,


    SRC_IN = 6,


    DST_IN = 7,


    SRC_OUT = 8,


    DST_OUT = 9,


    SRC_ATOP = 10,


    DST_ATOP = 11,


    XOR = 12,


    PLUS = 13,


    MODULATE = 14,


    SCREEN = 15,


    OVERLAY = 16,


    DARKEN = 17,


    LIGHTEN = 18,


    COLOR_DODGE = 19,


    COLOR_BURN = 20,


    HARD_LIGHT = 21,


    SOFT_LIGHT = 22,


    DIFFERENCE = 23,


    EXCLUSION = 24,


    MULTIPLY = 25,


    HUE = 26,


    SATURATION = 27,


    COLOR = 28,


    LUMINOSITY = 29
}


declare enum BlendApplyType {


    FAST = 0,


    OFFSCREEN = 1,
}


declare interface DragEvent {


    getDisplayX(): number;


    getDisplayY(): number;


    getWindowX(): number;


    getWindowY(): number;


    getX(): number;


    getY(): number;


    dragBehavior: DragBehavior;


    useCustomDropAnimation: boolean;


    setData(unifiedData: UnifiedData): void;


    getData(): UnifiedData;


    getSummary(): Summary;


    setResult(dragResult: DragResult): void;


    getResult(): DragResult;


    getPreviewRect(): Rectangle;


    getVelocityX(): number;


    getVelocityY(): number;


    getVelocity(): number;


    getModifierKeyState?(keys: Array<string>): boolean;
}


declare type IntentionCode = import('../api/@ohos.multimodalInput.intentionCode').IntentionCode;


declare interface KeyEvent {


    type: KeyType;


    keyCode: number;


    keyText: string;


    keySource: KeySource;


    deviceId: number;


    metaKey: number;


    timestamp: number;


    stopPropagation: () => void;


    intentionCode: IntentionCode;


    getModifierKeyState?(keys: Array<string>): boolean;


    unicode?: number;
}


declare interface BindOptions {


    backgroundColor?: ResourceColor;


    onAppear?: () => void;


    onDisappear?: () => void;


    onWillAppear?: () => void;


    onWillDisappear?: () => void;
}


declare interface DismissContentCoverAction {

    dismiss: Callback<void>;


    reason: DismissReason;
}


declare interface ContentCoverOptions extends BindOptions {


    modalTransition?: ModalTransition,


    onWillDismiss?: Callback<DismissContentCoverAction>;


    transition?: TransitionEffect;
}


declare interface SheetTitleOptions {


    title: ResourceStr;


    subtitle?: ResourceStr;
}


declare enum SheetType {


    BOTTOM = 0,


    CENTER = 1,


    POPUP = 2,
}


declare enum SheetMode {

    OVERLAY = 0,


    EMBEDDED = 1,
}


declare enum ScrollSizeMode {

    FOLLOW_DETENT = 0,


    CONTINUOUS = 1,
}


declare interface SheetDismiss {


    dismiss: () => void;
}


declare interface DismissSheetAction {


    dismiss: Callback<void>;


    reason: DismissReason;
}


declare interface SpringBackAction {

    springBack: Callback<void>;
}


declare interface SheetOptions extends BindOptions {


    height?: SheetSize | Length;


    dragBar?: boolean;


    maskColor?: ResourceColor;


    detents?: [(SheetSize | Length), (SheetSize | Length)?, (SheetSize | Length)?];


    blurStyle?: BlurStyle;


    showClose?: boolean | Resource;


    preferType?: SheetType;


    title?: SheetTitleOptions | CustomBuilder;


    shouldDismiss?: (sheetDismiss: SheetDismiss) => void;


    onWillDismiss?: Callback<DismissSheetAction>;


    onWillSpringBackWhenDismiss?: Callback<SpringBackAction>;


    enableOutsideInteractive?: boolean;


    width?: Dimension;


    borderWidth?: Dimension | EdgeWidths | LocalizedEdgeWidths;


    borderColor?: ResourceColor | EdgeColors | LocalizedEdgeColors;


    borderStyle?: BorderStyle | EdgeStyles;


    shadow?: ShadowOptions | ShadowStyle;


    onHeightDidChange?: Callback<number>;


    mode?: SheetMode;


    scrollSizeMode?: ScrollSizeMode;


    onDetentsDidChange?: Callback<number>;


    onWidthDidChange?: Callback<number>;


    onTypeDidChange?: Callback<SheetType>;


    expandSafeAreaInEmbeddedMode?: boolean;


    uiContext?: UIContext;
}


declare interface StateStyles {


    normal?: any;


    pressed?: any;


    disabled?: any;


    focused?: any;


    clicked?: any;


    selected?: object;
}


declare interface PopupMessageOptions {


    textColor?: ResourceColor;


    font?: Font;
}


declare enum DismissReason {

    PRESS_BACK = 0,


    TOUCH_OUTSIDE = 1,


    CLOSE_BUTTON = 2,


    SLIDE_DOWN = 3
}


declare interface DismissPopupAction {

    dismiss: Callback<void>;


    reason: DismissReason;
}


declare interface PopupOptions {


    message: string;


    placementOnTop?: boolean;


    placement?: Placement;


    primaryButton?: {


        value: string;


        action: () => void;
    };


    secondaryButton?: {


        value: string;


        action: () => void;
    };


    onStateChange?: (event: {


        isVisible: boolean
    }) => void;


    arrowOffset?: Length;


    showInSubWindow?: boolean;


    mask?: boolean | { color: ResourceColor };


    messageOptions?: PopupMessageOptions


    targetSpace?: Length


    enableArrow?: boolean;


    offset?: Position


    popupColor?: Color | string | Resource | number;


    autoCancel?: boolean;


    width?: Dimension;


    arrowPointPosition?: ArrowPointPosition;


    arrowWidth?: Dimension;


    arrowHeight?: Dimension;


    radius?: Dimension;


    shadow?: ShadowOptions | ShadowStyle;


    backgroundBlurStyle?: BlurStyle;


    transition?: TransitionEffect;


    onWillDismiss?: boolean | Callback<DismissPopupAction>;


    enableHoverMode?: boolean;
}


declare interface CustomPopupOptions {


    builder: CustomBuilder;


    placement?: Placement;


    maskColor?: Color | string | Resource | number;


    popupColor?: Color | string | Resource | number;


    enableArrow?: boolean;


    autoCancel?: boolean;


    onStateChange?: (event: {


        isVisible: boolean
    }) => void;


    arrowOffset?: Length;


    showInSubWindow?: boolean;


    mask?: boolean | { color: ResourceColor };


    targetSpace?: Length


    offset?: Position


    width?: Dimension;


    arrowPointPosition?: ArrowPointPosition;


    arrowWidth?: Dimension;


    arrowHeight?: Dimension;


    radius?: Dimension;


    shadow?: ShadowOptions | ShadowStyle;


    backgroundBlurStyle?: BlurStyle;


    focusable?: boolean;


    transition?: TransitionEffect;


    onWillDismiss?: boolean | Callback<DismissPopupAction>;


    enableHoverMode?: boolean;
}


declare enum MenuPreviewMode {


    NONE = 0,


    IMAGE = 1
}


declare type AnimationRange<T> = [from: T, to: T];


interface ContextMenuAnimationOptions {


    scale?: AnimationRange<number>;

    transition?: TransitionEffect;


    hoverScale?: AnimationRange<number>;
}


declare interface ContextMenuOptions {


    offset?: Position;


    placement?: Placement;


    enableArrow?: boolean;


    arrowOffset?: Length;


    preview?: MenuPreviewMode | CustomBuilder;


    borderRadius?: Length | BorderRadiuses | LocalizedBorderRadiuses;


    onAppear?: () => void;


    onDisappear?: () => void;


    aboutToAppear?: () => void;


    aboutToDisappear?: () => void;


    previewAnimationOptions?: ContextMenuAnimationOptions;


    backgroundColor?: ResourceColor;


    backgroundBlurStyle?: BlurStyle;


    transition?: TransitionEffect;


    enableHoverMode?: boolean;
}


declare interface MenuOptions extends ContextMenuOptions {


    title?: ResourceStr;


    showInSubWindow?: boolean;
}


declare class ProgressMask {


    constructor(value: number, total: number, color: ResourceColor);


    updateProgress(value: number): void;


    updateColor(value: ResourceColor): void;


    enableBreathingAnimation(value: boolean): void;
}


declare class TouchTestInfo {


    windowX: number;


    windowY: number;


    parentX: number;


    parentY: number;


    x: number;


    y: number;


    rect: RectResult;


    id: string;
}


declare class TouchResult {


    strategy: TouchTestStrategy;


    id?: string;
}


declare interface PixelStretchEffectOptions {


    top?: Length;


    bottom?: Length;


    left?: Length;


    right?: Length;
}


declare interface ClickEffect {


    level: ClickEffectLevel;


    scale?: number;
}


declare interface FadingEdgeOptions {

    fadingEdgeLength?: LengthMetrics;
}


declare interface NestedScrollOptions {


    scrollForward: NestedScrollMode;


    scrollBackward: NestedScrollMode;
}


declare interface MenuElement {


    value: ResourceStr;


    icon?: ResourceStr;


    symbolIcon?: SymbolGlyphModifier;


    enabled?: boolean;


    action: () => void;
}


declare interface AttributeModifier<T> {


    applyNormalAttribute?(instance: T): void;


    applyPressedAttribute?(instance: T): void;


    applyFocusedAttribute?(instance: T): void;


    applyDisabledAttribute?(instance: T): void;


    applySelectedAttribute?(instance: T): void;
}


declare interface ContentModifier<T> {


    applyContent(): WrappedBuilder<[T]>
}


declare interface CommonConfiguration<T> {


    enabled: boolean,


    contentModifier: ContentModifier<T>
}


declare enum OutlineStyle {


    SOLID = 0,


    DASHED = 1,


    DOTTED = 2,
}


declare enum DragPreviewMode {


    AUTO = 1,


    DISABLE_SCALE = 2,

    ENABLE_DEFAULT_SHADOW = 3,

    ENABLE_DEFAULT_RADIUS = 4,
}


declare enum MenuPolicy {

    DEFAULT = 0,


    HIDE = 1,


    SHOW = 2,
}


declare type ImageModifier = import('../api/arkui/ImageModifier').ImageModifier;


declare type SymbolGlyphModifier = import('../api/arkui/SymbolGlyphModifier').SymbolGlyphModifier;


declare interface DragPreviewOptions {


    mode?: DragPreviewMode | Array<DragPreviewMode>;


    modifier?: ImageModifier;


    numberBadge?: boolean | number;
}


declare interface DragInteractionOptions {

    isMultiSelectionEnabled?: boolean;


    defaultAnimationBeforeLifting?: boolean;
}


declare interface InvertOptions {


    low: number;


    high: number;


    threshold: number;


    thresholdRange: number;
}


declare type CircleShape = import('../api/@ohos.arkui.shape').CircleShape;


declare type EllipseShape = import('../api/@ohos.arkui.shape').EllipseShape;


declare type PathShape = import('../api/@ohos.arkui.shape').PathShape;


declare type RectShape = import('../api/@ohos.arkui.shape').RectShape;


declare type Optional<T> = T | undefined;


declare class CommonMethod<T> {


    constructor();


    width(value: Length): T;


    height(value: Length): T;


    drawModifier(modifier: DrawModifier | undefined): T;


    customProperty(name: string, value: Optional<Object>): T;


    expandSafeArea(types?: Array<SafeAreaType>, edges?: Array<SafeAreaEdge>): T;


    responseRegion(value: Array<Rectangle> | Rectangle): T;


    mouseResponseRegion(value: Array<Rectangle> | Rectangle): T;


    size(value: SizeOptions): T;


    constraintSize(value: ConstraintSizeOptions): T;


    touchable(value: boolean): T;


    hitTestBehavior(value: HitTestMode): T;


    onChildTouchTest(event: (value: Array<TouchTestInfo>) => TouchResult): T;


    layoutWeight(value: number | string): T;


    padding(value: Padding | Length | LocalizedPadding): T;


    margin(value: Margin | Length | LocalizedMargin): T;


    background(builder: CustomBuilder, options?: { align?: Alignment }): T;


    backgroundColor(value: ResourceColor): T;


    pixelRound(value: PixelRoundPolicy): T;


    backgroundImage(src: ResourceStr | PixelMap, repeat?: ImageRepeat): T;


    backgroundImageSize(value: SizeOptions | ImageSize): T;


    backgroundImagePosition(value: Position | Alignment): T;


    backgroundBlurStyle(value: BlurStyle, options?: BackgroundBlurStyleOptions): T;


    backgroundEffect(options: BackgroundEffectOptions): T;


    backgroundImageResizable(value: ResizableOptions): T;


    foregroundEffect(options: ForegroundEffectOptions): T;


    visualEffect(effect: VisualEffect): T;


    backgroundFilter(filter: Filter): T;


    foregroundFilter(filter: Filter): T;


    compositingFilter(filter: Filter): T;


    foregroundBlurStyle(value: BlurStyle, options?: ForegroundBlurStyleOptions): T;


    opacity(value: number | Resource): T;


    border(value: BorderOptions): T;


    borderStyle(value: BorderStyle | EdgeStyles): T;


    borderWidth(value: Length | EdgeWidths | LocalizedEdgeWidths): T;


    borderColor(value: ResourceColor | EdgeColors | LocalizedEdgeColors): T;


    borderRadius(value: Length | BorderRadiuses | LocalizedBorderRadiuses): T;


    borderImage(value: BorderImageOption): T;


    outline(value: OutlineOptions): T;


    outlineStyle(value: OutlineStyle | EdgeOutlineStyles): T;


    outlineWidth(value: Dimension | EdgeOutlineWidths): T;


    outlineColor(value: ResourceColor | EdgeColors | LocalizedEdgeColors): T;


    outlineRadius(value: Dimension | OutlineRadiuses): T;


    foregroundColor(value: ResourceColor | ColoringStrategy): T;


    onClick(event: (event: ClickEvent) => void): T;


    onClick(event: Callback<ClickEvent>, distanceThreshold: number): T;


    onHover(event: (isHover: boolean, event: HoverEvent) => void): T;


    onAccessibilityHover(callback: AccessibilityCallback): T;


    hoverEffect(value: HoverEffect): T;


    onMouse(event: (event: MouseEvent) => void): T;


    onTouch(event: (event: TouchEvent) => void): T;


    onKeyEvent(event: (event: KeyEvent) => void): T;


    onKeyPreIme(event: Callback<KeyEvent, boolean>): T;


    focusable(value: boolean): T;


    onFocus(event: () => void): T;


    onBlur(event: () => void): T;


    tabIndex(index: number): T;


    defaultFocus(value: boolean): T;


    groupDefaultFocus(value: boolean): T;


    focusOnTouch(value: boolean): T;


    focusBox(style: FocusBoxStyle): T;


    focusScopeId(id: string, isGroup?: boolean): T;


    focusScopePriority(scopeId: string, priority?: FocusPriority): T;


    animation(value: AnimateParam): T;


    transition(value: TransitionOptions | TransitionEffect): T;


    transition(effect: TransitionEffect, onFinish: Optional<TransitionFinishCallback>): T;


    gesture(gesture: GestureType, mask?: GestureMask): T;


    priorityGesture(gesture: GestureType, mask?: GestureMask): T;


    parallelGesture(gesture: GestureType, mask?: GestureMask): T;


    blur(value: number, options?: BlurOptions): T;


    linearGradientBlur(value: number, options: LinearGradientBlurOptions): T;


    motionBlur(value: MotionBlurOptions): T;


    brightness(value: number): T;


    contrast(value: number): T;


    grayscale(value: number): T;


    colorBlend(value: Color | string | Resource): T;


    saturate(value: number): T;


    sepia(value: number): T;


    invert(value: number | InvertOptions): T;


    systemBarEffect(): T;


    hueRotate(value: number | string): T;


    useShadowBatching(value: boolean): T;


    useEffect(value: boolean): T;


    backdropBlur(value: number, options?: BlurOptions): T;


    renderGroup(value: boolean): T;


    freeze(value: boolean): T;


    translate(value: TranslateOptions): T;


    scale(value: ScaleOptions): T;


    gridSpan(value: number): T;


    gridOffset(value: number): T;


    rotate(value: RotateOptions): T;


    transform(value: object): T;


    onAppear(event: () => void): T;


    onDisAppear(event: () => void): T;


    onAttach(callback: Callback<void>): T;


    onDetach(callback: Callback<void>): T;


    onAreaChange(event: (oldValue: Area, newValue: Area) => void): T;


    visibility(value: Visibility): T;


    flexGrow(value: number): T;


    flexShrink(value: number): T;


    flexBasis(value: number | string): T;


    alignSelf(value: ItemAlign): T;


    displayPriority(value: number): T;


    zIndex(value: number): T;


    sharedTransition(id: string, options?: sharedTransitionOptions): T;


    direction(value: Direction): T;


    align(value: Alignment): T;


    position(value: Position | Edges | LocalizedEdges): T;


    markAnchor(value: Position | LocalizedPosition): T;


    offset(value: Position | Edges | LocalizedEdges): T;


    enabled(value: boolean): T;


    useSizeType(value: {
        xs?: number | { span: number; offset: number };
        sm?: number | { span: number; offset: number };
        md?: number | { span: number; offset: number };
        lg?: number | { span: number; offset: number };
    }): T;


    alignRules(value: AlignRuleOption): T;


    alignRules(alignRule: LocalizedAlignRuleOptions): T;


    chainMode(direction: Axis, style: ChainStyle): T;


    aspectRatio(value: number): T;


    clickEffect(value: ClickEffect | null): T;


    onDragStart(event: (event: DragEvent, extraParams?: string) => CustomBuilder | DragItemInfo): T;


    onDragEnter(event: (event: DragEvent, extraParams?: string) => void): T;


    onDragMove(event: (event: DragEvent, extraParams?: string) => void): T;


    onDragLeave(event: (event: DragEvent, extraParams?: string) => void): T;


    onDrop(event: (event: DragEvent, extraParams?: string) => void): T;


    onDragEnd(event: (event: DragEvent, extraParams?: string) => void): T;


    allowDrop(value: Array<UniformDataType> | null): T;


    draggable(value: boolean): T;


    dragPreview(value: CustomBuilder | DragItemInfo | string): T;


    dragPreviewOptions(value: DragPreviewOptions, options?: DragInteractionOptions): T;


    onPreDrag(callback: Callback<PreDragStatus>): T;


    overlay(value: string | CustomBuilder | ComponentContent, options?: OverlayOptions): T;


    linearGradient(value: {
        angle?: number | string;
        direction?: GradientDirection;
        colors: Array<[ResourceColor, number]>;
        repeating?: boolean;
    }): T;


    sweepGradient(value: {
        center: [Length, Length];
        start?: number | string;
        end?: number | string;
        rotation?: number | string;
        colors: Array<[ResourceColor, number]>;
        repeating?: boolean;
    }): T;


    radialGradient(value: {
        center: [Length, Length];
        radius: number | string;
        colors: Array<[ResourceColor, number]>;
        repeating?: boolean;
    }): T;


    motionPath(value: MotionPathOptions): T;


    shadow(value: ShadowOptions | ShadowStyle): T;


    blendMode(value: BlendMode, type?: BlendApplyType): T;


    advancedBlendMode(effect: BlendMode | Blender, type?: BlendApplyType): T;


    clip(value: boolean): T;


    clip(value: boolean | CircleAttribute | EllipseAttribute | PathAttribute | RectAttribute): T;


    clipShape(value: CircleShape | EllipseShape | PathShape | RectShape): T;


    mask(value: ProgressMask): T;


    mask(value: CircleAttribute | EllipseAttribute | PathAttribute | RectAttribute | ProgressMask): T;


    maskShape(value: CircleShape | EllipseShape | PathShape | RectShape): T;


    key(value: string): T;


    id(value: string): T;


    geometryTransition(id: string): T;


    geometryTransition(id: string, options?: GeometryTransitionOptions): T;


    bindPopup(show: boolean, popup: PopupOptions | CustomPopupOptions): T;


    bindMenu(content: Array<MenuElement> | CustomBuilder, options?: MenuOptions): T;


    bindMenu(isShow: boolean, content: Array<MenuElement> | CustomBuilder, options?: MenuOptions): T;


    bindContextMenu(content: CustomBuilder, responseType: ResponseType, options?: ContextMenuOptions): T;


    bindContextMenu(isShown: boolean, content: CustomBuilder, options?: ContextMenuOptions): T;


    bindContentCover(isShow: Optional<boolean>, builder: CustomBuilder, type?: ModalTransition): T;


    bindContentCover(isShow: Optional<boolean>, builder: CustomBuilder, options?: ContentCoverOptions): T;


    bindSheet(isShow: Optional<boolean>, builder: CustomBuilder, options?: SheetOptions): T;


    stateStyles(value: StateStyles): T;


    restoreId(value: number): T;


    onVisibleAreaChange(ratios: Array<number>, event: (isVisible: boolean, currentRatio: number) => void): T;


    sphericalEffect(value: number): T;


    lightUpEffect(value: number): T;


    pixelStretchEffect(options: PixelStretchEffectOptions): T;


    keyboardShortcut(value: string | FunctionKey, keys: Array<ModifierKey>, action?: () => void): T;


    accessibilityGroup(value: boolean): T;


    accessibilityText(value: string): T;


    accessibilityText(text: Resource): T;


    accessibilityTextHint(value: string): T;


    accessibilityDescription(value: string): T;


    accessibilityDescription(description: Resource): T;


    accessibilityLevel(value: string): T;


    accessibilityVirtualNode(builder: CustomBuilder): T;


    obscured(reasons: Array<ObscuredReasons>): T;


    reuseId(id: string): T;


    renderFit(fitMode: RenderFit): T;


    attributeModifier(modifier: AttributeModifier<T>): T;


    gestureModifier(modifier: GestureModifier): T;


    backgroundBrightness(params: BackgroundBrightnessOptions): T;


    onGestureJudgeBegin(callback: (gestureInfo: GestureInfo, event: BaseGestureEvent) => GestureJudgeResult): T;


    onGestureRecognizerJudgeBegin(callback: GestureRecognizerJudgeBeginCallback): T;


    shouldBuiltInRecognizerParallelWith(callback: ShouldBuiltInRecognizerParallelWithCallback): T;


    monopolizeEvents(monopolize: boolean): T;


    onTouchIntercept(callback: Callback<TouchEvent, HitTestMode>): T;


    onSizeChange(event: SizeChangeCallback): T;
}


declare class CommonAttribute extends CommonMethod<CommonAttribute> {
}


interface CommonInterface {


    (): CommonAttribute;
}


declare const CommonInstance: CommonAttribute;


declare const Common: CommonInterface;


declare type CustomBuilder = (() => any) | void;


declare interface OverlayOptions {


    align?: Alignment;


    offset?: OverlayOffset;
}


declare interface OverlayOffset {


    x?: number;


    y?: number;
}


declare type FractionStop = [number, number];


declare class CommonShapeMethod<T> extends CommonMethod<T> {


    constructor();


    stroke(value: ResourceColor): T;


    fill(value: ResourceColor): T;


    strokeDashOffset(value: number | string): T;


    strokeLineCap(value: LineCapStyle): T;


    strokeLineJoin(value: LineJoinStyle): T;


    strokeMiterLimit(value: number | string): T;


    strokeOpacity(value: number | string | Resource): T;


    fillOpacity(value: number | string | Resource): T;


    strokeWidth(value: Length): T;


    antiAlias(value: boolean): T;


    strokeDashArray(value: Array<any>): T;
}


declare interface LinearGradient {


    angle?: number | string;


    direction?: GradientDirection;


    colors: Array<[ResourceColor, number]>;


    repeating?: boolean;
}


declare interface PixelRoundPolicy {

    start?: PixelRoundCalcPolicy;


    top?: PixelRoundCalcPolicy;


    end?: PixelRoundCalcPolicy;


    bottom?: PixelRoundCalcPolicy;
}


declare interface LinearGradientBlurOptions {

    fractionStops: FractionStop[];

    direction: GradientDirection;
}


declare interface MotionBlurAnchor {

    x: number;

    y: number;
}


declare interface MotionBlurOptions {

    radius: number;

    anchor: MotionBlurAnchor;
}


declare interface LayoutBorderInfo {

    borderWidth: EdgeWidths;


    margin: Margin,


    padding: Padding,
}


declare interface LayoutInfo {

    position: Position,


    constraint: ConstraintSizeOptions,
}


declare interface LayoutChild {

    name: string,


    id: string,


    constraint: ConstraintSizeOptions,


    borderInfo: LayoutBorderInfo,


    position: Position,


    measure(childConstraint: ConstraintSizeOptions),


    layout(childLayoutInfo: LayoutInfo),
}


declare interface GeometryInfo extends SizeResult {


    borderWidth: EdgeWidth;


    margin: Margin,


    padding: Padding,
}


declare interface Layoutable {


    measureResult: MeasureResult,


    layout(position: Position): void,


    getMargin(): DirectionalEdgesT<number>,


    getPadding(): DirectionalEdgesT<number>,


    getBorderWidth(): DirectionalEdgesT<number>,
}


declare interface Measurable {


    measure(constraint: ConstraintSizeOptions): MeasureResult,


    getMargin(): DirectionalEdgesT<number>,


    getPadding(): DirectionalEdgesT<number>,


    getBorderWidth(): DirectionalEdgesT<number>,
}


declare interface SizeResult {


    width: number,


    height: number,
}


declare interface MeasureResult extends SizeResult {

}


declare type NavDestinationInfo = import('../api/@ohos.arkui.observer').default.NavDestinationInfo;


declare type NavigationInfo = import('../api/@ohos.arkui.observer').default.NavigationInfo;


declare type RouterPageInfo = import('../api/@ohos.arkui.observer').default.RouterPageInfo;


declare type UIContext = import('../api/@ohos.arkui.UIContext').UIContext;


declare type DrawContext = import('../api/arkui/Graphics').DrawContext;


declare type VisualEffect = import('../api/@ohos.graphics.uiEffect').default.VisualEffect;


declare type Filter = import('../api/@ohos.graphics.uiEffect').default.Filter;


declare type Blender = import('../api/@ohos.graphics.uiEffect').default.Blender;


declare type ComponentContent<T = Object> = import('../api/arkui/ComponentContent').ComponentContent<T>;


declare type Theme = import('../api/@ohos.arkui.theme').Theme;


declare class CustomComponent extends CommonAttribute {


    build(): void;


    aboutToAppear?(): void;


    aboutToDisappear?(): void;


    aboutToReuse?(params: { [key: string]: unknown }): void;


    aboutToRecycle?(): void;


    onWillApplyTheme?(theme: Theme): void;


    onLayout?(children: Array<LayoutChild>, constraint: ConstraintSizeOptions): void;


    onPlaceChildren?(selfLayoutInfo: GeometryInfo, children: Array<Layoutable>, constraint: ConstraintSizeOptions): void;


    onMeasure?(children: Array<LayoutChild>, constraint: ConstraintSizeOptions): void;


    onMeasureSize?(selfLayoutInfo: GeometryInfo, children: Array<Measurable>, constraint: ConstraintSizeOptions): SizeResult;


    onPageShow?(): void;


    onPageHide?(): void;


    onFormRecycle?(): string;


    onFormRecover?(statusData: string): void;


    onBackPress?(): void | boolean;


    pageTransition?(): void;


    getUIContext(): UIContext;


    getUniqueId(): number;


    queryNavDestinationInfo(): NavDestinationInfo | undefined;


    queryNavigationInfo(): NavigationInfo | undefined;


    queryRouterPageInfo(): RouterPageInfo | undefined;


    onDidBuild?(): void;
}


declare class View {


    create(value: any): any;
}


declare interface RectResult {


    x: number;


    y: number;


    width: number;


    height: number;
}


declare interface CaretOffset {


    index: number;


    x: number;


    y: number;
}


declare abstract class TextContentControllerBase {


    getCaretOffset(): CaretOffset;


    getTextContentRect(): RectResult;


    getTextContentLineCount(): number;
}


declare class ScrollableCommonMethod<T> extends CommonMethod<T> {

    scrollBar(barState: BarState): T;


    scrollBarColor(color: Color | number | string): T;


    scrollBarWidth(value: number | string): T;


    edgeEffect(edgeEffect: EdgeEffect, options?: EdgeEffectOptions): T;


    fadingEdge(enabled: Optional<boolean>, options?: FadingEdgeOptions): T;


    nestedScroll(value: NestedScrollOptions): T;


    enableScrollInteraction(value: boolean): T;


    friction(value: number | Resource): T;


    onScroll(event: (scrollOffset: number, scrollState: ScrollState) => void): T;


    onWillScroll(handler: Optional<OnWillScrollCallback>): T;


    onDidScroll(handler: OnScrollCallback): T;


    onReachStart(event: () => void): T;


    onReachEnd(event: () => void): T;


    onScrollStart(event: () => void): T;


    onScrollStop(event: () => void): T;


    flingSpeedLimit(speedLimit: number): T;
}


declare class ScrollResult {

    offsetRemain: number;
}


declare type OnWillScrollCallback =
    (scrollOffset: number, scrollState: ScrollState, scrollSource: ScrollSource) => void | ScrollResult;


declare type OnScrollCallback = (scrollOffset: number, scrollState: ScrollState) => void;


declare type OnMoveHandler = (from: number, to: number) => void;


declare class DynamicNode<T> {

    onMove(handler: Optional<OnMoveHandler>): T;
}


declare interface EdgeEffectOptions {


    alwaysEnabled: boolean;
}


declare class ChildrenMainSize {

    constructor(childDefaultSize: number);


    set childDefaultSize(value: number);


    get childDefaultSize(): number;


    splice(start: number, deleteCount?: number, childrenSize?: Array<number>): void;


    update(index: number, childSize: number): void;
}


declare interface BackgroundBrightnessOptions {


    rate: number;


    lightUpDegree: number;
}


declare interface PointLightStyle {

    lightSource?: LightSource;

    illuminated?: IlluminatedType;

    bloom?: number;
}


declare interface LightSource {

    positionX: Dimension;

    positionY: Dimension;

    positionZ: Dimension;

    intensity: number;

    color?: ResourceColor;
}


declare function wrapBuilder<Args extends Object[]>(builder: (...args: Args) => void): WrappedBuilder<Args>;


declare class WrappedBuilder<Args extends Object[]> {


    builder: (...args: Args) => void;


    constructor(builder: (...args: Args) => void);
}


declare interface KeyframeAnimateParam {


    delay?: number;


    iterations?: number;


    onFinish?: () => void;
}


declare interface KeyframeState {


    duration: number;


    curve?: Curve | string | ICurve;


    event: () => void;
}


declare interface Callback<T, V = void> {

    (data: T): V;
}


declare type HoverCallback = (isHover: boolean, event: HoverEvent) => void


declare type AccessibilityCallback = (isHover: boolean, event: AccessibilityHoverEvent) => void


declare interface VisibleAreaEventOptions {

    ratios: Array<number>;


    expectedUpdateInterval?: number;
}


declare type VisibleAreaChangeCallback = (isVisible: boolean, currentRatio: number) => void;


declare interface UICommonEvent {

    setOnClick(callback: Callback<ClickEvent> | undefined): void;


    setOnTouch(callback: Callback<TouchEvent> | undefined): void;


    setOnAppear(callback: Callback<void> | undefined): void;


    setOnDisappear(callback: Callback<void> | undefined): void;


    setOnKeyEvent(callback: Callback<KeyEvent> | undefined): void;


    setOnFocus(callback: Callback<void> | undefined): void;


    setOnBlur(callback: Callback<void> | undefined): void;


    setOnHover(callback: HoverCallback | undefined): void;


    setOnMouse(callback: Callback<MouseEvent> | undefined): void;


    setOnSizeChange(callback: SizeChangeCallback | undefined): void;


    setOnVisibleAreaApproximateChange(options: VisibleAreaEventOptions, event: VisibleAreaChangeCallback | undefined): void;
}


declare interface UIGestureEvent {

    addGesture<T>(gesture: GestureHandler<T>, priority?: GesturePriority, mask?: GestureMask): void;


    addParallelGesture<T>(gesture: GestureHandler<T>, mask?: GestureMask): void;


    removeGestureByTag(tag: string): void;


    clearGestures(): void;
}


declare interface GestureModifier {

    applyGesture(event: UIGestureEvent): void;
}


declare interface SelectionOptions {

    menuPolicy?: MenuPolicy;
}


declare enum KeyboardAvoidMode {

    DEFAULT = 0,

    NONE = 1,
}


declare enum HoverModeAreaType {

    TOP_SCREEN = 0,

    BOTTOM_SCREEN = 1,
}
