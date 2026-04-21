/**
 * Comprehensive ArkUI component type declarations for ArkTaint static analysis.
 *
 * These declarations provide type signatures for HarmonyOS ArkUI components,
 * their event-handling methods and attribute methods. They are loaded as an SDK
 * into arkanalyzer's Scene so that SDK Provenance can correctly identify ArkUI
 * component methods without requiring the full HarmonyOS SDK installation.
 *
 * Coverage: all official ArkUI components and CommonAttribute methods as of
 * HarmonyOS 4.x / API 11+. Each method returns its owner attribute type to
 * support chain-call type resolution.
 */

// ============================================================================
// Event / option types (opaque — only used as callback parameter types)
// ============================================================================

declare interface ClickEvent {}
declare interface TouchEvent {}
declare interface KeyEvent {}
declare interface MouseEvent {}
declare interface FocusEvent {}
declare interface HoverEvent {}
declare interface AreaChangeEvent {}
declare interface VisibleAreaChangeEvent {}
declare interface DragEvent {}
declare interface GestureEvent {}
declare interface PanGestureEvent {}
declare interface PinchGestureEvent {}
declare interface RotationGestureEvent {}
declare interface SwipeGestureEvent {}
declare interface ScrollEvent {}
declare interface AppearEvent {}
declare interface SizeOptions {}
declare interface Area {}
declare interface Resource {}
declare interface SubmitEvent {}
declare interface RichEditorSelection {}
declare interface RichEditorInsertValue {}
declare interface RichEditorDeleteValue {}
declare interface NavPathStack {}

// ============================================================================
// CommonAttribute — shared by virtually all ArkUI components
// ============================================================================

declare class CommonAttribute {

    // ── Universal events ────────────────────────────────────────────────
    onClick(event: (event?: ClickEvent) => void): CommonAttribute;
    onTouch(event: (event?: TouchEvent) => void): CommonAttribute;
    onFocus(event: () => void): CommonAttribute;
    onBlur(event: () => void): CommonAttribute;
    onHover(event: (isHover?: boolean, event?: HoverEvent) => void): CommonAttribute;
    onMouse(event: (event?: MouseEvent) => void): CommonAttribute;
    onKeyEvent(event: (event?: KeyEvent) => void): CommonAttribute;
    onAppear(event: () => void): CommonAttribute;
    onDisAppear(event: () => void): CommonAttribute;
    onAreaChange(event: (oldValue: Area, newValue: Area) => void): CommonAttribute;
    onSizeChange(event: (oldValue: SizeOptions, newValue: SizeOptions) => void): CommonAttribute;
    onVisibleAreaChange(ratios: number[], event: (isVisible: boolean, currentRatio: number) => void): CommonAttribute;
    onDragStart(event: (event?: DragEvent) => void): CommonAttribute;
    onDragEnter(event: (event?: DragEvent) => void): CommonAttribute;
    onDragMove(event: (event?: DragEvent) => void): CommonAttribute;
    onDragLeave(event: (event?: DragEvent) => void): CommonAttribute;
    onDragEnd(event: (event?: DragEvent) => void): CommonAttribute;
    onDrop(event: (event?: DragEvent) => void): CommonAttribute;
    onAccessibilityHover(event: (isHover: boolean) => void): CommonAttribute;
    gesture(gesture: any, mask?: number): CommonAttribute;
    parallelGesture(gesture: any, mask?: number): CommonAttribute;
    priorityGesture(gesture: any, mask?: number): CommonAttribute;

    // ── Size / layout ───────────────────────────────────────────────────
    width(value: any): CommonAttribute;
    height(value: any): CommonAttribute;
    size(value: any): CommonAttribute;
    margin(value: any): CommonAttribute;
    padding(value: any): CommonAttribute;
    constraintSize(value: any): CommonAttribute;
    layoutWeight(value: any): CommonAttribute;
    aspectRatio(value: any): CommonAttribute;
    displayPriority(value: any): CommonAttribute;

    // ── Position ────────────────────────────────────────────────────────
    position(value: any): CommonAttribute;
    offset(value: any): CommonAttribute;
    zIndex(value: any): CommonAttribute;
    align(value: any): CommonAttribute;
    alignSelf(value: any): CommonAttribute;
    alignRules(value: any): CommonAttribute;
    direction(value: any): CommonAttribute;
    markAnchor(value: any): CommonAttribute;

    // ── Flex child ──────────────────────────────────────────────────────
    flexGrow(value: any): CommonAttribute;
    flexShrink(value: any): CommonAttribute;
    flexBasis(value: any): CommonAttribute;

    // ── Grid child ──────────────────────────────────────────────────────
    gridSpan(value: any): CommonAttribute;
    gridOffset(value: any): CommonAttribute;
    useSizeType(value: any): CommonAttribute;

    // ── Border ──────────────────────────────────────────────────────────
    border(value: any): CommonAttribute;
    borderWidth(value: any): CommonAttribute;
    borderColor(value: any): CommonAttribute;
    borderRadius(value: any): CommonAttribute;
    borderStyle(value: any): CommonAttribute;
    borderImage(value: any): CommonAttribute;

    // ── Outline ─────────────────────────────────────────────────────────
    outline(value: any): CommonAttribute;
    outlineColor(value: any): CommonAttribute;
    outlineWidth(value: any): CommonAttribute;
    outlineRadius(value: any): CommonAttribute;
    outlineStyle(value: any): CommonAttribute;

    // ── Background ──────────────────────────────────────────────────────
    backgroundColor(value: any): CommonAttribute;
    backgroundImage(value: any, repeat?: any): CommonAttribute;
    backgroundImageSize(value: any): CommonAttribute;
    backgroundImagePosition(value: any): CommonAttribute;
    backgroundBlurStyle(value: any): CommonAttribute;
    foregroundBlurStyle(value: any): CommonAttribute;

    // ── Visual effects ──────────────────────────────────────────────────
    opacity(value: any): CommonAttribute;
    shadow(value: any): CommonAttribute;
    blur(value: any): CommonAttribute;
    backdropBlur(value: any): CommonAttribute;
    grayscale(value: any): CommonAttribute;
    brightness(value: any): CommonAttribute;
    saturate(value: any): CommonAttribute;
    contrast(value: any): CommonAttribute;
    invert(value: any): CommonAttribute;
    sepia(value: any): CommonAttribute;
    hueRotate(value: any): CommonAttribute;
    colorBlend(value: any): CommonAttribute;
    blendMode(value: any): CommonAttribute;
    sphericalEffect(value: any): CommonAttribute;
    lightUpEffect(value: any): CommonAttribute;
    pixelStretchEffect(value: any): CommonAttribute;
    renderFit(value: any): CommonAttribute;
    renderGroup(value: any): CommonAttribute;

    // ── Gradients ───────────────────────────────────────────────────────
    linearGradient(value: any): CommonAttribute;
    radialGradient(value: any): CommonAttribute;
    sweepGradient(value: any): CommonAttribute;

    // ── Text style (inherited by text-capable components) ───────────────
    fontSize(value: any): CommonAttribute;
    fontWeight(value: any): CommonAttribute;
    fontColor(value: any): CommonAttribute;
    fontStyle(value: any): CommonAttribute;
    fontFamily(value: any): CommonAttribute;
    textAlign(value: any): CommonAttribute;
    lineHeight(value: any): CommonAttribute;
    letterSpacing(value: any): CommonAttribute;
    maxLines(value: any): CommonAttribute;
    textOverflow(value: any): CommonAttribute;
    decoration(value: any): CommonAttribute;
    copyOption(value: any): CommonAttribute;
    textCase(value: any): CommonAttribute;
    textShadow(value: any): CommonAttribute;
    wordBreak(value: any): CommonAttribute;
    lineSpacing(value: any): CommonAttribute;
    minFontSize(value: any): CommonAttribute;
    maxFontSize(value: any): CommonAttribute;
    heightAdaptivePolicy(value: any): CommonAttribute;
    textIndent(value: any): CommonAttribute;

    // ── Input-related (inherited by input components) ────────────────────
    type(value: any): CommonAttribute;
    placeholderFont(value: any): CommonAttribute;
    placeholderColor(value: any): CommonAttribute;
    caretColor(value: any): CommonAttribute;
    caretStyle(value: any): CommonAttribute;
    maxLength(value: any): CommonAttribute;
    inputFilter(value: any, error?: any): CommonAttribute;
    enterKeyType(value: any): CommonAttribute;
    selectedColor(value: any): CommonAttribute;
    selectionMenuHidden(value: any): CommonAttribute;
    showPasswordIcon(value: any): CommonAttribute;
    passwordIcon(value: any): CommonAttribute;
    showPassword(value: any): CommonAttribute;
    showCounter(value: any): CommonAttribute;
    showUnderline(value: any): CommonAttribute;
    passwordRules(value: any): CommonAttribute;
    enableAutoFill(value: any): CommonAttribute;

    // ── Image-related ───────────────────────────────────────────────────
    fillColor(value: any): CommonAttribute;
    objectFit(value: any): CommonAttribute;
    objectRepeat(value: any): CommonAttribute;
    autoResize(value: any): CommonAttribute;
    sourceSize(value: any): CommonAttribute;
    matchTextDirection(value: any): CommonAttribute;
    renderMode(value: any): CommonAttribute;
    interpolation(value: any): CommonAttribute;
    alt(value: any): CommonAttribute;
    syncLoad(value: any): CommonAttribute;
    draggable(value: any): CommonAttribute;
    colorFilter(value: any): CommonAttribute;
    copyable(value: any): CommonAttribute;

    // ── Scrollable container ────────────────────────────────────────────
    scrollable(value: any): CommonAttribute;
    scrollBar(value: any): CommonAttribute;
    scrollBarColor(value: any): CommonAttribute;
    scrollBarWidth(value: any): CommonAttribute;
    edgeEffect(value: any): CommonAttribute;
    nestedScroll(value: any): CommonAttribute;
    enableScrollInteraction(value: any): CommonAttribute;
    friction(value: any): CommonAttribute;
    flingSpeedLimit(value: any): CommonAttribute;

    // ── List / Grid layout ──────────────────────────────────────────────
    listDirection(value: any): CommonAttribute;
    lanes(value: any, gutter?: any): CommonAttribute;
    divider(value: any): CommonAttribute;
    cachedCount(value: any): CommonAttribute;
    space(value: any): CommonAttribute;
    alignContent(value: any): CommonAttribute;
    justifyContent(value: any): CommonAttribute;
    wrap(value: any): CommonAttribute;
    columnsTemplate(value: any): CommonAttribute;
    rowsTemplate(value: any): CommonAttribute;
    columnsGap(value: any): CommonAttribute;
    rowsGap(value: any): CommonAttribute;
    multiSelectable(value: any): CommonAttribute;
    sticky(value: any): CommonAttribute;
    editMode(value: any): CommonAttribute;
    chainAnimation(value: any): CommonAttribute;

    // ── Tab / Bar ───────────────────────────────────────────────────────
    barBackgroundColor(value: any): CommonAttribute;
    barMode(value: any): CommonAttribute;
    barWidth(value: any): CommonAttribute;
    barHeight(value: any): CommonAttribute;
    barPosition(value: any): CommonAttribute;

    // ── Transform / animation ───────────────────────────────────────────
    rotate(value: any): CommonAttribute;
    translate(value: any): CommonAttribute;
    scale(value: any): CommonAttribute;
    transform(value: any): CommonAttribute;
    transition(value: any): CommonAttribute;
    animation(value: any): CommonAttribute;
    sharedTransition(id: string, options?: any): CommonAttribute;
    geometryTransition(id: string): CommonAttribute;
    motionPath(value: any): CommonAttribute;
    motionBlur(value: any): CommonAttribute;

    // ── Focus / accessibility ───────────────────────────────────────────
    visibility(value: any): CommonAttribute;
    enabled(value: any): CommonAttribute;
    clip(value: any): CommonAttribute;
    clipShape(value: any): CommonAttribute;
    mask(value: any): CommonAttribute;
    focusable(value: any): CommonAttribute;
    tabIndex(value: any): CommonAttribute;
    defaultFocus(value: any): CommonAttribute;
    groupDefaultFocus(value: any): CommonAttribute;
    focusOnTouch(value: any): CommonAttribute;
    id(value: any): CommonAttribute;
    key(value: any): CommonAttribute;
    restoreId(value: any): CommonAttribute;
    accessibilityText(value: any): CommonAttribute;
    accessibilityDescription(value: any): CommonAttribute;
    accessibilityLevel(value: any): CommonAttribute;
    accessibilityGroup(value: any): CommonAttribute;
    accessibilityImportance(value: any): CommonAttribute;
    obscured(value: any): CommonAttribute;

    // ── Interaction ─────────────────────────────────────────────────────
    hitTestBehavior(value: any): CommonAttribute;
    responseRegion(value: any): CommonAttribute;
    mouseResponseRegion(value: any): CommonAttribute;
    touchable(value: any): CommonAttribute;
    monopolizeEvents(value: any): CommonAttribute;
    clickEffect(value: any): CommonAttribute;
    hoverEffect(value: any): CommonAttribute;

    // ── Popup / sheet / menu binding ────────────────────────────────────
    overlay(value: any, options?: any): CommonAttribute;
    foregroundColor(value: any): CommonAttribute;
    bindPopup(show: any, popup: any): CommonAttribute;
    bindMenu(content: any, options?: any): CommonAttribute;
    bindSheet(isShow: any, builder: any, options?: any): CommonAttribute;
    bindContentCover(isShow: any, builder: any, options?: any): CommonAttribute;
    bindContextMenu(content: any, responseType: any, options?: any): CommonAttribute;

    // ── Misc styling ────────────────────────────────────────────────────
    stateStyles(value: any): CommonAttribute;
    expandSafeArea(value: any): CommonAttribute;
    attributeModifier(value: any): CommonAttribute;
    reuseId(value: any): CommonAttribute;
    color(value: any): CommonAttribute;
    value(value: any): CommonAttribute;
    style(value: any): CommonAttribute;
    total(value: any): CommonAttribute;

    // ── Swiper-related ──────────────────────────────────────────────────
    autoPlay(value: any): CommonAttribute;
    interval(value: any): CommonAttribute;
    indicator(value: any): CommonAttribute;
    loop(value: any): CommonAttribute;
    duration(value: any): CommonAttribute;
    vertical(value: any): CommonAttribute;
    itemSpace(value: any): CommonAttribute;
    displayMode(value: any): CommonAttribute;
    displayCount(value: any): CommonAttribute;
    effectMode(value: any): CommonAttribute;
    curve(value: any): CommonAttribute;
    index(value: any): CommonAttribute;
    disableSwipe(value: any): CommonAttribute;
    prevMargin(value: any): CommonAttribute;
    nextMargin(value: any): CommonAttribute;

    // ── Shape-related ───────────────────────────────────────────────────
    fill(value: any): CommonAttribute;
    stroke(value: any): CommonAttribute;
    strokeWidth(value: any): CommonAttribute;
    strokeDashArray(value: any): CommonAttribute;
    strokeDashOffset(value: any): CommonAttribute;
    strokeLineCap(value: any): CommonAttribute;
    strokeLineJoin(value: any): CommonAttribute;
    strokeMiterLimit(value: any): CommonAttribute;
    strokeOpacity(value: any): CommonAttribute;
    fillOpacity(value: any): CommonAttribute;
    antiAlias(value: any): CommonAttribute;
    viewPort(value: any): CommonAttribute;
    mesh(value: any, column: any, row: any): CommonAttribute;

    // ── Navigation-related ──────────────────────────────────────────────
    title(value: any): CommonAttribute;
    menus(value: any): CommonAttribute;
    titleMode(value: any): CommonAttribute;
    toolBar(value: any): CommonAttribute;
    toolbarConfiguration(value: any): CommonAttribute;
    hideToolBar(value: any): CommonAttribute;
    hideTitleBar(value: any): CommonAttribute;
    hideBackButton(value: any): CommonAttribute;
    navBarWidth(value: any): CommonAttribute;
    navBarPosition(value: any): CommonAttribute;
    navBarWidthRange(value: any): CommonAttribute;
    minContentWidth(value: any): CommonAttribute;
    mode(value: any): CommonAttribute;
    backButtonIcon(value: any): CommonAttribute;

    // ── Miscellaneous component-specific (placed here to avoid chain breaks) ─
    selected(value: any): CommonAttribute;
    select(value: any): CommonAttribute;
    checked(value: any): CommonAttribute;
    selectedDate(value: any): CommonAttribute;
    lunar(value: any): CommonAttribute;
    useMilitaryTime(value: any): CommonAttribute;
    disappearTextStyle(value: any): CommonAttribute;
    textStyle(value: any): CommonAttribute;
    selectedTextStyle(value: any): CommonAttribute;
    defaultPickerItemHeight(value: any): CommonAttribute;
    canLoop(value: any): CommonAttribute;
    blockColor(value: any): CommonAttribute;
    trackColor(value: any): CommonAttribute;
    trackThickness(value: any): CommonAttribute;
    showTips(value: any): CommonAttribute;
    showSteps(value: any): CommonAttribute;
    blockBorderColor(value: any): CommonAttribute;
    blockBorderWidth(value: any): CommonAttribute;
    stepColor(value: any): CommonAttribute;
    stepSize(value: any): CommonAttribute;
    trackBorderRadius(value: any): CommonAttribute;
    blockSize(value: any): CommonAttribute;
    blockStyle(value: any): CommonAttribute;
    min(value: any): CommonAttribute;
    max(value: any): CommonAttribute;
    step(value: any): CommonAttribute;
    reverse(value: any): CommonAttribute;
    slideRange(value: any): CommonAttribute;
    starStyle(value: any): CommonAttribute;
    indicator2(value: any): CommonAttribute;
    stars(value: any): CommonAttribute;
    stepSize2(value: any): CommonAttribute;
    contentType(value: any): CommonAttribute;
    enableKeyboardOnFocus(value: any): CommonAttribute;
    selectAll(value: any): CommonAttribute;
    showError(value: any): CommonAttribute;
    barState(value: any): CommonAttribute;
    label(value: any): CommonAttribute;
    menuAlign(value: any): CommonAttribute;
    optionWidth(value: any): CommonAttribute;
    optionHeight(value: any): CommonAttribute;
    optionFont(value: any): CommonAttribute;
    optionFontColor(value: any): CommonAttribute;
    optionBgColor(value: any): CommonAttribute;
    arrowPosition(value: any): CommonAttribute;
    searchButton(value: any): CommonAttribute;
    searchIcon(value: any): CommonAttribute;
    cancelButton(value: any): CommonAttribute;
    textFont(value: any): CommonAttribute;
    icon(value: any): CommonAttribute;
    buttonStyle(value: any): CommonAttribute;
    switchPointColor(value: any): CommonAttribute;
    selectedFontColor(value: any): CommonAttribute;
    popupFont(value: any): CommonAttribute;
    popupColor(value: any): CommonAttribute;
    popupBackground(value: any): CommonAttribute;
    usingPopup(value: any): CommonAttribute;
    alignStyle(value: any): CommonAttribute;
    popupItemFont(value: any): CommonAttribute;
    popupItemBackgroundColor(value: any): CommonAttribute;
    autoCollapse(value: any): CommonAttribute;
    sideBarWidth(value: any): CommonAttribute;
    minSideBarWidth(value: any): CommonAttribute;
    maxSideBarWidth(value: any): CommonAttribute;
    sideBarPosition(value: any): CommonAttribute;
    showSideBar(value: any): CommonAttribute;
    showControlButton(value: any): CommonAttribute;
    controlButton(value: any): CommonAttribute;
    regularColor(value: any): CommonAttribute;
    activeOpacity(value: any): CommonAttribute;
    sideBarTop(value: any): CommonAttribute;
    autoHide(value: any): CommonAttribute;
}

// ============================================================================
// Layout containers
// ============================================================================

declare class ColumnAttribute extends CommonAttribute {}
declare function Column(value?: any): ColumnAttribute;

declare class RowAttribute extends CommonAttribute {}
declare function Row(value?: any): RowAttribute;

declare class StackAttribute extends CommonAttribute {}
declare function Stack(value?: any): StackAttribute;

declare class FlexAttribute extends CommonAttribute {}
declare function Flex(value?: any): FlexAttribute;

declare class GridAttribute extends CommonAttribute {
    onScrollIndex(event: (first: number) => void): GridAttribute;
    onScrollBarUpdate(event: (index: number, offset: number) => { totalOffset: number; totalLength: number }): GridAttribute;
    onItemDragStart(event: (event: any, itemIndex: number) => any): GridAttribute;
    onItemDragEnter(event: (event: any) => void): GridAttribute;
    onItemDragMove(event: (event: any, itemIndex: number, insertIndex: number) => void): GridAttribute;
    onItemDragLeave(event: (event: any, itemIndex: number) => void): GridAttribute;
    onItemDrop(event: (event: any, itemIndex: number, insertIndex: number, isSuccess: boolean) => void): GridAttribute;
    onReachStart(event: () => void): GridAttribute;
    onReachEnd(event: () => void): GridAttribute;
    onScrollStart(event: () => void): GridAttribute;
    onScrollStop(event: () => void): GridAttribute;
    onScrollFrameBegin(event: (offset: number, state: number) => { offsetRemain: number }): GridAttribute;
}
declare function Grid(scroller?: any): GridAttribute;

declare class GridItemAttribute extends CommonAttribute {
    onSelect(event: (isSelected: boolean) => void): GridItemAttribute;
}
declare function GridItem(): GridItemAttribute;

declare class GridColAttribute extends CommonAttribute {}
declare function GridCol(value?: any): GridColAttribute;

declare class GridRowAttribute extends CommonAttribute {
    onBreakpointChange(event: (breakpoint: string) => void): GridRowAttribute;
}
declare function GridRow(value?: any): GridRowAttribute;

declare class ListAttribute extends CommonAttribute {
    onScroll(event: (scrollOffset: number, scrollState: number) => void): ListAttribute;
    onScrollIndex(event: (start: number, end: number) => void): ListAttribute;
    onReachStart(event: () => void): ListAttribute;
    onReachEnd(event: () => void): ListAttribute;
    onScrollStart(event: () => void): ListAttribute;
    onScrollStop(event: () => void): ListAttribute;
    onScrollFrameBegin(event: (offset: number, state: number) => { offsetRemain: number }): ListAttribute;
    onItemDragStart(event: (event: any, itemIndex: number) => any): ListAttribute;
    onItemDragEnter(event: (event: any) => void): ListAttribute;
    onItemDragMove(event: (event: any, itemIndex: number, insertIndex: number) => void): ListAttribute;
    onItemDragLeave(event: (event: any, itemIndex: number) => void): ListAttribute;
    onItemDrop(event: (event: any, itemIndex: number, insertIndex: number, isSuccess: boolean) => void): ListAttribute;
    onItemMove(event: (from: number, to: number) => boolean): ListAttribute;
    onItemDelete(event: (index: number) => boolean): ListAttribute;
}
declare function List(value?: any): ListAttribute;

declare class ListItemAttribute extends CommonAttribute {
    onSelect(event: (isSelected: boolean) => void): ListItemAttribute;
}
declare function ListItem(value?: any): ListItemAttribute;

declare class ListItemGroupAttribute extends CommonAttribute {}
declare function ListItemGroup(value?: any): ListItemGroupAttribute;

declare class ScrollAttribute extends CommonAttribute {
    onScroll(event: (xOffset: number, yOffset: number) => void): ScrollAttribute;
    onScrollEdge(event: (side: number) => void): ScrollAttribute;
    onScrollStart(event: () => void): ScrollAttribute;
    onScrollStop(event: () => void): ScrollAttribute;
    onScrollEnd(event: () => void): ScrollAttribute;
    onScrollFrameBegin(event: (offset: number, state: number) => { offsetRemain: number }): ScrollAttribute;
}
declare function Scroll(scroller?: any): ScrollAttribute;

declare class SwiperAttribute extends CommonAttribute {
    onChange(event: (index: number) => void): SwiperAttribute;
    onAnimationStart(event: (index: number, targetIndex: number, extraInfo: any) => void): SwiperAttribute;
    onAnimationEnd(event: (index: number, extraInfo: any) => void): SwiperAttribute;
    onGestureSwipe(event: (index: number, extraInfo: any) => void): SwiperAttribute;
}
declare function Swiper(controller?: any): SwiperAttribute;

declare class TabsAttribute extends CommonAttribute {
    onChange(event: (index: number) => void): TabsAttribute;
    onTabBarClick(event: (index: number) => void): TabsAttribute;
    onAnimationStart(event: (index: number, targetIndex: number, event: any) => void): TabsAttribute;
    onAnimationEnd(event: (index: number, event: any) => void): TabsAttribute;
    onGestureSwipe(event: (index: number, event: any) => void): TabsAttribute;
}
declare function Tabs(value?: any): TabsAttribute;

declare class TabContentAttribute extends CommonAttribute {
    tabBar(value: any): TabContentAttribute;
}
declare function TabContent(): TabContentAttribute;

declare class WaterFlowAttribute extends CommonAttribute {
    onReachStart(event: () => void): WaterFlowAttribute;
    onReachEnd(event: () => void): WaterFlowAttribute;
    onScrollStart(event: () => void): WaterFlowAttribute;
    onScrollStop(event: () => void): WaterFlowAttribute;
    onScrollIndex(event: (first: number, last: number) => void): WaterFlowAttribute;
    onScrollFrameBegin(event: (offset: number, state: number) => { offsetRemain: number }): WaterFlowAttribute;
}
declare function WaterFlow(value?: any): WaterFlowAttribute;

declare class FlowItemAttribute extends CommonAttribute {}
declare function FlowItem(): FlowItemAttribute;

declare class RelativeContainerAttribute extends CommonAttribute {}
declare function RelativeContainer(): RelativeContainerAttribute;

declare class RowSplitAttribute extends CommonAttribute {}
declare function RowSplit(): RowSplitAttribute;

declare class ColumnSplitAttribute extends CommonAttribute {}
declare function ColumnSplit(): ColumnSplitAttribute;

declare class SideBarContainerAttribute extends CommonAttribute {
    onChange(event: (value: boolean) => void): SideBarContainerAttribute;
}
declare function SideBarContainer(type?: any): SideBarContainerAttribute;

// ============================================================================
// Basic display components
// ============================================================================

declare class ButtonAttribute extends CommonAttribute {}
declare function Button(value?: string | any): ButtonAttribute;

declare class TextAttribute extends CommonAttribute {}
declare function Text(content?: string | Resource): TextAttribute;

declare class SpanAttribute {
    onClick(event: (event?: ClickEvent) => void): SpanAttribute;
    fontSize(value: any): SpanAttribute;
    fontColor(value: any): SpanAttribute;
    fontWeight(value: any): SpanAttribute;
    fontStyle(value: any): SpanAttribute;
    fontFamily(value: any): SpanAttribute;
    textAlign(value: any): SpanAttribute;
    lineHeight(value: any): SpanAttribute;
    letterSpacing(value: any): SpanAttribute;
    decoration(value: any): SpanAttribute;
    textCase(value: any): SpanAttribute;
    textShadow(value: any): SpanAttribute;
    baselineOffset(value: any): SpanAttribute;
    textBackgroundStyle(value: any): SpanAttribute;
    font(value: any): SpanAttribute;
}
declare function Span(value?: string | Resource): SpanAttribute;

declare class ImageSpanAttribute {
    onClick(event: (event?: ClickEvent) => void): ImageSpanAttribute;
    verticalAlign(value: any): ImageSpanAttribute;
    objectFit(value: any): ImageSpanAttribute;
}
declare function ImageSpan(value: string | Resource | any): ImageSpanAttribute;

declare class ImageAttribute extends CommonAttribute {
    onComplete(event: (event?: any) => void): ImageAttribute;
    onError(event: (event?: any) => void): ImageAttribute;
    onFinish(event: () => void): ImageAttribute;
}
declare function Image(src: string | Resource | any): ImageAttribute;

declare class ImageAnimatorAttribute extends CommonAttribute {
    onStart(event: () => void): ImageAnimatorAttribute;
    onPause(event: () => void): ImageAnimatorAttribute;
    onRepeat(event: () => void): ImageAnimatorAttribute;
    onCancel(event: () => void): ImageAnimatorAttribute;
    onFinish(event: () => void): ImageAnimatorAttribute;
    images(value: any[]): ImageAnimatorAttribute;
    state(value: any): ImageAnimatorAttribute;
    fixedSize(value: any): ImageAnimatorAttribute;
    fillMode(value: any): ImageAnimatorAttribute;
    iterations(value: any): ImageAnimatorAttribute;
}
declare function ImageAnimator(): ImageAnimatorAttribute;

declare class DividerAttribute extends CommonAttribute {}
declare function Divider(): DividerAttribute;

declare class BlankAttribute extends CommonAttribute {}
declare function Blank(min?: number | string): BlankAttribute;

declare class BadgeAttribute extends CommonAttribute {}
declare function Badge(value: any): BadgeAttribute;

declare class LoadingProgressAttribute extends CommonAttribute {}
declare function LoadingProgress(): LoadingProgressAttribute;

declare class ProgressAttribute extends CommonAttribute {}
declare function Progress(options: any): ProgressAttribute;

declare class MarqueeAttribute extends CommonAttribute {
    onStart(event: () => void): MarqueeAttribute;
    onBounce(event: () => void): MarqueeAttribute;
    onFinish(event: () => void): MarqueeAttribute;
}
declare function Marquee(value: any): MarqueeAttribute;

declare class QRCodeAttribute extends CommonAttribute {}
declare function QRCode(value: string): QRCodeAttribute;

declare class GaugeAttribute extends CommonAttribute {}
declare function Gauge(value: any): GaugeAttribute;

declare class DataPanelAttribute extends CommonAttribute {}
declare function DataPanel(value: any): DataPanelAttribute;

declare class TextClockAttribute extends CommonAttribute {
    onDateChange(event: (value: number) => void): TextClockAttribute;
}
declare function TextClock(controller?: any): TextClockAttribute;

declare class TextTimerAttribute extends CommonAttribute {
    onTimer(event: (utc: number, elapsedTime: number) => void): TextTimerAttribute;
}
declare function TextTimer(options?: any): TextTimerAttribute;

// ============================================================================
// Input components
// ============================================================================

declare class TextInputAttribute extends CommonAttribute {
    onChange(event: (value: string) => void): TextInputAttribute;
    onSubmit(event: (enterKey: number, event?: SubmitEvent) => void): TextInputAttribute;
    onEditChange(event: (isEditing: boolean) => void): TextInputAttribute;
    onCopy(event: (value: string) => void): TextInputAttribute;
    onCut(event: (value: string) => void): TextInputAttribute;
    onPaste(event: (value: string, event?: any) => void): TextInputAttribute;
    onTextSelectionChange(event: (selectionStart: number, selectionEnd: number) => void): TextInputAttribute;
    onContentScroll(event: (totalOffsetX: number, totalOffsetY: number) => void): TextInputAttribute;
}
declare function TextInput(value?: any): TextInputAttribute;

declare class TextAreaAttribute extends CommonAttribute {
    onChange(event: (value: string) => void): TextAreaAttribute;
    onEditChange(event: (isEditing: boolean) => void): TextAreaAttribute;
    onCopy(event: (value: string) => void): TextAreaAttribute;
    onCut(event: (value: string) => void): TextAreaAttribute;
    onPaste(event: (value: string, event?: any) => void): TextAreaAttribute;
    onTextSelectionChange(event: (selectionStart: number, selectionEnd: number) => void): TextAreaAttribute;
    onContentScroll(event: (totalOffsetX: number, totalOffsetY: number) => void): TextAreaAttribute;
    onSubmit(event: (enterKey: number, event?: SubmitEvent) => void): TextAreaAttribute;
}
declare function TextArea(value?: any): TextAreaAttribute;

declare class ToggleAttribute extends CommonAttribute {
    onChange(event: (isOn: boolean) => void): ToggleAttribute;
}
declare function Toggle(options: any): ToggleAttribute;

declare class SliderAttribute extends CommonAttribute {
    onChange(event: (value: number, mode: number) => void): SliderAttribute;
}
declare function Slider(options?: any): SliderAttribute;

declare class SelectAttribute extends CommonAttribute {
    onSelect(event: (index: number, value?: string) => void): SelectAttribute;
}
declare function Select(options: any[]): SelectAttribute;

declare class CheckboxAttribute extends CommonAttribute {
    onChange(event: (value: boolean) => void): CheckboxAttribute;
}
declare function Checkbox(options?: any): CheckboxAttribute;

declare class CheckboxGroupAttribute extends CommonAttribute {
    onChange(event: (event: any) => void): CheckboxGroupAttribute;
}
declare function CheckboxGroup(options?: any): CheckboxGroupAttribute;

declare class RadioAttribute extends CommonAttribute {
    onChange(event: (isChecked: boolean) => void): RadioAttribute;
}
declare function Radio(options: any): RadioAttribute;

declare class RatingAttribute extends CommonAttribute {
    onChange(event: (value: number) => void): RatingAttribute;
}
declare function Rating(options?: any): RatingAttribute;

declare class SearchAttribute extends CommonAttribute {
    onSubmit(event: (value: string) => void): SearchAttribute;
    onChange(event: (value: string) => void): SearchAttribute;
    onCopy(event: (value: string) => void): SearchAttribute;
    onCut(event: (value: string) => void): SearchAttribute;
    onPaste(event: (value: string, event?: any) => void): SearchAttribute;
    onTextSelectionChange(event: (selectionStart: number, selectionEnd: number) => void): SearchAttribute;
    onContentScroll(event: (totalOffsetX: number, totalOffsetY: number) => void): SearchAttribute;
}
declare function Search(options?: any): SearchAttribute;

declare class CounterAttribute extends CommonAttribute {
    onInc(event: () => void): CounterAttribute;
    onDec(event: () => void): CounterAttribute;
}
declare function Counter(): CounterAttribute;

declare class DatePickerAttribute extends CommonAttribute {
    onChange(event: (value: any) => void): DatePickerAttribute;
    onDateChange(event: (value: any) => void): DatePickerAttribute;
}
declare function DatePicker(value?: any): DatePickerAttribute;

declare class TimePickerAttribute extends CommonAttribute {
    onChange(event: (value: any) => void): TimePickerAttribute;
}
declare function TimePicker(value?: any): TimePickerAttribute;

declare class TextPickerAttribute extends CommonAttribute {
    onChange(event: (value: any) => void): TextPickerAttribute;
    onScrollStop(event: (value: any) => void): TextPickerAttribute;
}
declare function TextPicker(value?: any): TextPickerAttribute;

declare class CalendarPickerAttribute extends CommonAttribute {
    onChange(event: (value: any) => void): CalendarPickerAttribute;
}
declare function CalendarPicker(value?: any): CalendarPickerAttribute;

declare class PatternLockAttribute extends CommonAttribute {
    onPatternComplete(event: (input: number[]) => void): PatternLockAttribute;
    onDotConnect(event: (index: number) => void): PatternLockAttribute;
}
declare function PatternLock(controller?: any): PatternLockAttribute;

// ============================================================================
// Rich editor
// ============================================================================

declare class RichEditorAttribute extends CommonAttribute {
    onReady(event: () => void): RichEditorAttribute;
    onSelect(event: (value: any) => void): RichEditorAttribute;
    aboutToIMEInput(event: (value: any) => boolean): RichEditorAttribute;
    onIMEInputComplete(event: (value: any) => void): RichEditorAttribute;
    aboutToDelete(event: (value: any) => boolean): RichEditorAttribute;
    onDeleteComplete(event: () => void): RichEditorAttribute;
    onEditingChange(event: (isEditing: boolean) => void): RichEditorAttribute;
    onSubmit(event: (enterKey: number, event?: SubmitEvent) => void): RichEditorAttribute;
    onPaste(event: (event?: any) => void): RichEditorAttribute;
}
declare function RichEditor(value: any): RichEditorAttribute;

declare class RichTextAttribute extends CommonAttribute {
    onStart(event: () => void): RichTextAttribute;
    onComplete(event: () => void): RichTextAttribute;
}
declare function RichText(content: string): RichTextAttribute;

// ============================================================================
// Navigation / Dialog
// ============================================================================

declare class NavigationAttribute extends CommonAttribute {
    onTitleModeChange(event: (titleMode: number) => void): NavigationAttribute;
    onNavBarStateChange(event: (isVisible: boolean) => void): NavigationAttribute;
    onNavigationModeChange(event: (mode: number) => void): NavigationAttribute;
}
declare function Navigation(pathInfos?: NavPathStack | any): NavigationAttribute;

declare class NavRouterAttribute extends CommonAttribute {
    onStateChange(event: (isActivated: boolean) => void): NavRouterAttribute;
}
declare function NavRouter(): NavRouterAttribute;

declare class NavDestinationAttribute extends CommonAttribute {
    onShown(event: () => void): NavDestinationAttribute;
    onHidden(event: () => void): NavDestinationAttribute;
    onBackPressed(event: () => boolean): NavDestinationAttribute;
    onReady(event: (context: any) => void): NavDestinationAttribute;
    onWillAppear(event: () => void): NavDestinationAttribute;
    onWillDisappear(event: () => void): NavDestinationAttribute;
    onWillShow(event: () => void): NavDestinationAttribute;
    onWillHide(event: () => void): NavDestinationAttribute;
}
declare function NavDestination(): NavDestinationAttribute;

declare class NavigatorAttribute extends CommonAttribute {}
declare function Navigator(value?: any): NavigatorAttribute;

declare class StepperAttribute extends CommonAttribute {
    onFinish(event: () => void): StepperAttribute;
    onSkip(event: () => void): StepperAttribute;
    onChange(event: (prevIndex: number, index: number) => void): StepperAttribute;
    onNext(event: (index: number, pendingIndex: number) => void): StepperAttribute;
    onPrevious(event: (index: number, pendingIndex: number) => void): StepperAttribute;
}
declare function Stepper(value?: any): StepperAttribute;

declare class StepperItemAttribute extends CommonAttribute {}
declare function StepperItem(): StepperItemAttribute;

declare class AlertDialogParam {
    confirm?: { value: string; action: () => void };
    cancel?: () => void;
    primaryButton?: { value: string; action: () => void };
    secondaryButton?: { value: string; action: () => void };
}

declare class PanelAttribute extends CommonAttribute {
    onChange(event: (width: number, height: number, mode: number) => void): PanelAttribute;
    onHeightChange(event: (value: number) => void): PanelAttribute;
}
declare function Panel(show: boolean): PanelAttribute;

declare class RefreshAttribute extends CommonAttribute {
    onStateChange(event: (state: number) => void): RefreshAttribute;
    onRefreshing(event: () => void): RefreshAttribute;
    onOffsetChange(event: (value: number) => void): RefreshAttribute;
}
declare function Refresh(value: any): RefreshAttribute;

// ============================================================================
// Media components
// ============================================================================

declare class VideoAttribute extends CommonAttribute {
    onStart(event: () => void): VideoAttribute;
    onPause(event: () => void): VideoAttribute;
    onFinish(event: () => void): VideoAttribute;
    onError(event: () => void): VideoAttribute;
    onPrepared(event: (event?: any) => void): VideoAttribute;
    onSeeking(event: (event?: any) => void): VideoAttribute;
    onSeeked(event: (event?: any) => void): VideoAttribute;
    onUpdate(event: (event?: any) => void): VideoAttribute;
    onFullscreenChange(event: (event?: any) => void): VideoAttribute;
    onStop(event: () => void): VideoAttribute;
}
declare function Video(value: any): VideoAttribute;

declare class WebAttribute extends CommonAttribute {
    onPageBegin(event: (event?: any) => void): WebAttribute;
    onPageEnd(event: (event?: any) => void): WebAttribute;
    onProgressChange(event: (event?: any) => void): WebAttribute;
    onErrorReceive(event: (event?: any) => void): WebAttribute;
    onHttpErrorReceive(event: (event?: any) => void): WebAttribute;
    onAlert(event: (event?: any) => boolean): WebAttribute;
    onConfirm(event: (event?: any) => boolean): WebAttribute;
    onConsole(event: (event?: any) => boolean): WebAttribute;
    onTitleReceive(event: (event?: any) => void): WebAttribute;
    onUrlLoadIntercept(event: (event?: any) => boolean): WebAttribute;
    onLoadIntercept(event: (event?: any) => boolean): WebAttribute;
    onDownloadStart(event: (event?: any) => void): WebAttribute;
    onGeolocationShow(event: (event?: any) => void): WebAttribute;
    onRequestSelected(event: () => void): WebAttribute;
    onRefreshAccessedHistory(event: (event?: any) => void): WebAttribute;
    onRenderExited(event: (event?: any) => void): WebAttribute;
    onShowFileSelector(event: (event?: any) => boolean): WebAttribute;
    onResourceLoad(event: (event?: any) => void): WebAttribute;
    onScaleChange(event: (event?: any) => void): WebAttribute;
    onPermissionRequest(event: (event?: any) => void): WebAttribute;
    onScreenCaptureRequest(event: (event?: any) => void): WebAttribute;
    onContextMenuShow(event: (event?: any) => boolean): WebAttribute;
    onSearchResultReceive(event: (event?: any) => void): WebAttribute;
    onScroll(event: (event?: any) => void): WebAttribute;
    onSslErrorEventReceive(event: (event?: any) => void): WebAttribute;
    onClientAuthenticationRequest(event: (event?: any) => void): WebAttribute;
    onWindowNew(event: (event?: any) => void): WebAttribute;
    onWindowExit(event: () => void): WebAttribute;
    onInterceptKeyEvent(event: (event?: any) => boolean): WebAttribute;
    onTouchIconUrlReceived(event: (event?: any) => void): WebAttribute;
    onFaviconReceived(event: (event?: any) => void): WebAttribute;
    onAudioStateChanged(event: (event?: any) => void): WebAttribute;
    onFirstContentfulPaint(event: (event?: any) => void): WebAttribute;
    onOverScroll(event: (event?: any) => void): WebAttribute;
}
declare function Web(value: any): WebAttribute;

// ============================================================================
// Canvas / Shape drawing
// ============================================================================

declare class CanvasAttribute extends CommonAttribute {
    onReady(event: () => void): CanvasAttribute;
}
declare function Canvas(context?: any): CanvasAttribute;

declare class ShapeAttribute extends CommonAttribute {}
declare function Shape(value?: any): ShapeAttribute;

declare class CircleAttribute extends CommonAttribute {}
declare function Circle(value?: any): CircleAttribute;

declare class RectAttribute extends CommonAttribute {}
declare function Rect(value?: any): RectAttribute;

declare class PathAttribute extends CommonAttribute {
    commands(value: string): PathAttribute;
}
declare function Path(value?: any): PathAttribute;

declare class LineAttribute extends CommonAttribute {
    startPoint(value: any): LineAttribute;
    endPoint(value: any): LineAttribute;
}
declare function Line(value?: any): LineAttribute;

declare class PolylineAttribute extends CommonAttribute {
    points(value: any[]): PolylineAttribute;
}
declare function Polyline(value?: any): PolylineAttribute;

declare class PolygonAttribute extends CommonAttribute {
    points(value: any[]): PolygonAttribute;
}
declare function Polygon(value?: any): PolygonAttribute;

declare class EllipseAttribute extends CommonAttribute {}
declare function Ellipse(value?: any): EllipseAttribute;

// ============================================================================
// Miscellaneous components
// ============================================================================

declare class XComponentAttribute extends CommonAttribute {
    onLoad(event: (event?: any) => void): XComponentAttribute;
    onDestroy(event: () => void): XComponentAttribute;
}
declare function XComponent(value: any): XComponentAttribute;

declare class PluginComponentAttribute extends CommonAttribute {
    onComplete(event: () => void): PluginComponentAttribute;
    onError(event: (info: any) => void): PluginComponentAttribute;
}
declare function PluginComponent(value: any): PluginComponentAttribute;

declare class FormComponentAttribute extends CommonAttribute {
    onAcquired(event: (info: any) => void): FormComponentAttribute;
    onError(event: (info: any) => void): FormComponentAttribute;
    onRouter(event: (info: any) => void): FormComponentAttribute;
    onUninstall(event: (info: any) => void): FormComponentAttribute;
}
declare function FormComponent(value: any): FormComponentAttribute;

declare class HyperlinkAttribute extends CommonAttribute {}
declare function Hyperlink(address: string, content?: string): HyperlinkAttribute;

declare class MenuAttribute extends CommonAttribute {}
declare function Menu(): MenuAttribute;

declare class MenuItemAttribute extends CommonAttribute {
    onChange(event: (selected: boolean) => void): MenuItemAttribute;
}
declare function MenuItem(value?: any): MenuItemAttribute;

declare class MenuItemGroupAttribute extends CommonAttribute {}
declare function MenuItemGroup(value?: any): MenuItemGroupAttribute;

declare class AlphabetIndexerAttribute extends CommonAttribute {
    onSelect(event: (index: number) => void): AlphabetIndexerAttribute;
    onRequestPopupData(event: (index: number) => string[]): AlphabetIndexerAttribute;
    onPopupSelect(event: (index: number) => void): AlphabetIndexerAttribute;
}
declare function AlphabetIndexer(value: any): AlphabetIndexerAttribute;

declare class RemoteWindowAttribute extends CommonAttribute {}
declare function RemoteWindow(target: any): RemoteWindowAttribute;

declare class EffectComponentAttribute extends CommonAttribute {}
declare function EffectComponent(): EffectComponentAttribute;

declare class RootSceneAttribute extends CommonAttribute {}
declare function RootScene(session: any): RootSceneAttribute;

declare class ForEachAttribute {}
declare function ForEach(arr: any[], itemGenerator: (item: any, index?: number) => void, keyGenerator?: (item: any, index?: number) => string): ForEachAttribute;

declare class LazyForEachAttribute {}
declare function LazyForEach(dataSource: any, itemGenerator: (item: any, index?: number) => void, keyGenerator?: (item: any, index?: number) => string): LazyForEachAttribute;

declare class IfAttribute {}
