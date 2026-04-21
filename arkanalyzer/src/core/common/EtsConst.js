"use strict";
/*
 * Copyright (c) 2024-2026 Huawei Device Co., Ltd.
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.COMPONENT = exports.BUILD_PROFILE_JSON5 = exports.OH_PACKAGE_JSON5 = exports.ON_OFF = exports.CALL_BACK = exports.COMPONENT_ATTRIBUTE = exports.COMPONENT_INSTANCE = exports.COMPONENT_COMMON = exports.SPECIAL_CONTAINER_COMPONENT = exports.COMPONENT_BUILD_FUNCTION = exports.COMPONENT_BRANCH_FUNCTION = exports.COMPONENT_IF_BRANCH = exports.COMPONENT_IF = exports.COMPONENT_REPEAT = exports.COMPONENT_CUSTOMVIEW = exports.COMPONENT_POP_FUNCTION = exports.COMPONENT_CREATE_FUNCTION = exports.COMPONENT_BEHAVIOR = exports.BUILDER_PARAM_DECORATOR = exports.BUILDER_DECORATOR = exports.ENTRY_DECORATOR = exports.COMPONENT_DECORATOR = exports.BUILDIN_ATOMIC_COMPONENT = exports.BUILDIN_SYSTEM_COMPONENT = exports.COMPONENT_LAZY_FOR_EACH = exports.COMPONENT_FOR_EACH = exports.ETS_COMPILER_OPTIONS = void 0;
exports.isEtsAtomicComponent = isEtsAtomicComponent;
exports.isEtsSystemComponent = isEtsSystemComponent;
exports.isEtsContainerComponent = isEtsContainerComponent;
exports.ETS_COMPILER_OPTIONS = {
    ets: {
        emitDecorators: [
            {
                name: 'Entry',
                emitParameters: true,
            },
            {
                name: 'Component',
                emitParameters: false,
            },
            {
                name: 'Reusable',
                emitParameters: false,
            },
            {
                name: 'CustomDialog',
                emitParameters: false,
            },
            {
                name: 'Consume',
                emitParameters: true,
            },
            {
                name: 'Link',
                emitParameters: false,
            },
            {
                name: 'LocalStorageLink',
                emitParameters: true,
            },
            {
                name: 'LocalStorageProp',
                emitParameters: true,
            },
            {
                name: 'ObjectLink',
                emitParameters: false,
            },
            {
                name: 'Prop',
                emitParameters: false,
            },
            {
                name: 'Provide',
                emitParameters: true,
            },
            {
                name: 'State',
                emitParameters: false,
            },
            {
                name: 'StorageLink',
                emitParameters: true,
            },
            {
                name: 'StorageProp',
                emitParameters: true,
            },
            {
                name: 'Builder',
                emitParameters: false,
            },
            {
                name: 'LocalBuilder',
                emitParameters: false,
            },
            {
                name: 'BuilderParam',
                emitParameters: false,
            },
            {
                name: 'Observed',
                emitParameters: false,
            },
            {
                name: 'Require',
                emitParameters: false,
            },
            {
                name: 'Sendable',
                emitParameters: false,
            },
            {
                name: 'Track',
                emitParameters: false,
            },
            {
                name: 'ComponentV2',
                emitParameters: true,
            },
            {
                name: 'ObservedV2',
                emitParameters: false,
            },
            {
                name: 'Trace',
                emitParameters: false,
            },
            {
                name: 'Local',
                emitParameters: false,
            },
            {
                name: 'Param',
                emitParameters: false,
            },
            {
                name: 'Once',
                emitParameters: false,
            },
            {
                name: 'Event',
                emitParameters: false,
            },
            {
                name: 'Monitor',
                emitParameters: true,
            },
            {
                name: 'Provider',
                emitParameters: true,
            },
            {
                name: 'Consumer',
                emitParameters: true,
            },
            {
                name: 'Computed',
                emitParameters: false,
            },
            {
                name: 'Type',
                emitParameters: true,
            },
        ],
        propertyDecorators: [
            {
                name: 'Link',
                needInitialization: false,
            },
            {
                name: 'Prop',
                needInitialization: false,
            },
            {
                name: 'ObjectLink',
                needInitialization: false,
            },
            {
                name: 'Consume',
                needInitialization: false,
            },
        ],
        render: {
            method: ['build', 'pageTransition'],
            decorator: ['LocalBuilder', 'Builder'],
        },
        components: [
            'AbilityComponent',
            'AlphabetIndexer',
            'Animator',
            'Badge',
            'Blank',
            'Button',
            'Calendar',
            'CalendarPicker',
            'Camera',
            'Canvas',
            'Checkbox',
            'CheckboxGroup',
            'Circle',
            'ColorPicker',
            'ColorPickerDialog',
            'Column',
            'ColumnSplit',
            'ContentSlot',
            'Counter',
            'DataPanel',
            'DatePicker',
            'Divider',
            'EffectComponent',
            'Ellipse',
            'EmbeddedComponent',
            'Flex',
            'FolderStack',
            'FormComponent',
            'FormLink',
            'Gauge',
            'GeometryView',
            'Grid',
            'GridItem',
            'GridContainer',
            'Hyperlink',
            'Image',
            'ImageAnimator',
            'Line',
            'List',
            'ListItem',
            'ListItemGroup',
            'LoadingProgress',
            'Marquee',
            'MediaCachedImage',
            'Menu',
            'MenuItem',
            'MenuItemGroup',
            'MovingPhotoView',
            'NavDestination',
            'NavRouter',
            'Navigation',
            'Navigator',
            'NodeContainer',
            'Option',
            'PageTransitionEnter',
            'PageTransitionExit',
            'Panel',
            'Particle',
            'Path',
            'PatternLock',
            'Piece',
            'PluginComponent',
            'Polygon',
            'Polyline',
            'Progress',
            'QRCode',
            'Radio',
            'Rating',
            'Rect',
            'Refresh',
            'RelativeContainer',
            'RemoteWindow',
            'RootScene',
            'Row',
            'RowSplit',
            'RichText',
            'Screen',
            'Scroll',
            'ScrollBar',
            'Search',
            'Section',
            'Select',
            'Shape',
            'Sheet',
            'SideBarContainer',
            'Slider',
            'Span',
            'Stack',
            'Stepper',
            'StepperItem',
            'Swiper',
            'SymbolGlyph',
            'SymbolSpan',
            'TabContent',
            'Tabs',
            'Text',
            'TextPicker',
            'TextClock',
            'TextArea',
            'TextInput',
            'TextTimer',
            'TimePicker',
            'Toggle',
            'Video',
            'Web',
            'WindowScene',
            'WithTheme',
            'XComponent',
            'GridRow',
            'GridCol',
            'WaterFlow',
            'FlowItem',
            'ImageSpan',
            'LocationButton',
            'PasteButton',
            'SaveButton',
            'UIExtensionComponent',
            'IsolatedComponent',
            'RichEditor',
            'Component3D',
            'ContainerSpan',
        ],
        extend: {
            decorator: ['Extend', 'AnimatableExtend'],
            components: [
                {
                    name: 'AbilityComponent',
                    type: 'AbilityComponentAttribute',
                    instance: 'AbilityComponentInstance',
                },
                {
                    name: 'AlphabetIndexer',
                    type: 'AlphabetIndexerAttribute',
                    instance: 'AlphabetIndexerInstance',
                },
                {
                    name: 'Animator',
                    type: 'AnimatorAttribute',
                    instance: 'AnimatorInstance',
                },
                {
                    name: 'Badge',
                    type: 'BadgeAttribute',
                    instance: 'BadgeInstance',
                },
                {
                    name: 'Blank',
                    type: 'BlankAttribute',
                    instance: 'BlankInstance',
                },
                {
                    name: 'Button',
                    type: 'ButtonAttribute',
                    instance: 'ButtonInstance',
                },
                {
                    name: 'Calendar',
                    type: 'CalendarAttribute',
                    instance: 'CalendarInstance',
                },
                {
                    name: 'CalendarPicker',
                    type: 'CalendarPickerAttribute',
                    instance: 'CalendarPickerInstance',
                },
                {
                    name: 'Camera',
                    type: 'CameraAttribute',
                    instance: 'CameraInstance',
                },
                {
                    name: 'Canvas',
                    type: 'CanvasAttribute',
                    instance: 'CanvasInstance',
                },
                {
                    name: 'Checkbox',
                    type: 'CheckboxAttribute',
                    instance: 'CheckboxInstance',
                },
                {
                    name: 'CheckboxGroup',
                    type: 'CheckboxGroupAttribute',
                    instance: 'CheckboxGroupInstance',
                },
                {
                    name: 'Circle',
                    type: 'CircleAttribute',
                    instance: 'CircleInstance',
                },
                {
                    name: 'ColorPicker',
                    type: 'ColorPickerAttribute',
                    instance: 'ColorPickerInstance',
                },
                {
                    name: 'ColorPickerDialog',
                    type: 'ColorPickerDialogAttribute',
                    instance: 'ColorPickerDialogInstance',
                },
                {
                    name: 'Column',
                    type: 'ColumnAttribute',
                    instance: 'ColumnInstance',
                },
                {
                    name: 'ColumnSplit',
                    type: 'ColumnSplitAttribute',
                    instance: 'ColumnSplitInstance',
                },
                {
                    name: 'Counter',
                    type: 'CounterAttribute',
                    instance: 'CounterInstance',
                },
                {
                    name: 'DataPanel',
                    type: 'DataPanelAttribute',
                    instance: 'DataPanelInstance',
                },
                {
                    name: 'DatePicker',
                    type: 'DatePickerAttribute',
                    instance: 'DatePickerInstance',
                },
                {
                    name: 'Divider',
                    type: 'DividerAttribute',
                    instance: 'DividerInstance',
                },
                {
                    name: 'EffectComponent',
                    type: 'EffectComponentAttribute',
                    instance: 'EffectComponentInstance',
                },
                {
                    name: 'Ellipse',
                    type: 'EllipseAttribute',
                    instance: 'EllipseInstance',
                },
                {
                    name: 'EmbeddedComponent',
                    type: 'EmbeddedComponentAttribute',
                    instance: 'EmbeddedComponentInstance',
                },
                {
                    name: 'Flex',
                    type: 'FlexAttribute',
                    instance: 'FlexInstance',
                },
                {
                    name: 'FolderStack',
                    type: 'FolderStackAttribute',
                    instance: 'FolderStackInstance',
                },
                {
                    name: 'FormComponent',
                    type: 'FormComponentAttribute',
                    instance: 'FormComponentInstance',
                },
                {
                    name: 'FormLink',
                    type: 'FormLinkAttribute',
                    instance: 'FormLinkInstance',
                },
                {
                    name: 'Gauge',
                    type: 'GaugeAttribute',
                    instance: 'GaugeInstance',
                },
                {
                    name: 'GeometryView',
                    type: 'GeometryViewAttribute',
                    instance: 'GeometryViewInstance',
                },
                {
                    name: 'Grid',
                    type: 'GridAttribute',
                    instance: 'GridInstance',
                },
                {
                    name: 'GridItem',
                    type: 'GridItemAttribute',
                    instance: 'GridItemInstance',
                },
                {
                    name: 'GridContainer',
                    type: 'GridContainerAttribute',
                    instance: 'GridContainerInstance',
                },
                {
                    name: 'Hyperlink',
                    type: 'HyperlinkAttribute',
                    instance: 'HyperlinkInstance',
                },
                {
                    name: 'Image',
                    type: 'ImageAttribute',
                    instance: 'ImageInstance',
                },
                {
                    name: 'ImageAnimator',
                    type: 'ImageAnimatorAttribute',
                    instance: 'ImageAnimatorInstance',
                },
                {
                    name: 'Line',
                    type: 'LineAttribute',
                    instance: 'LineInstance',
                },
                {
                    name: 'List',
                    type: 'ListAttribute',
                    instance: 'ListInstance',
                },
                {
                    name: 'ListItem',
                    type: 'ListItemAttribute',
                    instance: 'ListItemInstance',
                },
                {
                    name: 'ListItemGroup',
                    type: 'ListItemGroupAttribute',
                    instance: 'ListItemGroupInstance',
                },
                {
                    name: 'LoadingProgress',
                    type: 'LoadingProgressAttribute',
                    instance: 'LoadingProgressInstance',
                },
                {
                    name: 'Marquee',
                    type: 'MarqueeAttribute',
                    instance: 'MarqueeInstance',
                },
                {
                    name: 'MediaCachedImage',
                    type: 'MediaCachedImageAttribute',
                    instance: 'MediaCachedImageInstance',
                },
                {
                    name: 'Menu',
                    type: 'MenuAttribute',
                    instance: 'MenuInstance',
                },
                {
                    name: 'MenuItem',
                    type: 'MenuItemAttribute',
                    instance: 'MenuItemInstance',
                },
                {
                    name: 'MenuItemGroup',
                    type: 'MenuItemGroupAttribute',
                    instance: 'MenuItemGroupInstance',
                },
                {
                    name: 'MovingPhotoView',
                    type: 'MovingPhotoViewAttribute',
                    instance: 'MovingPhotoViewInstance',
                },
                {
                    name: 'NavDestination',
                    type: 'NavDestinationAttribute',
                    instance: 'NavDestinationInstance',
                },
                {
                    name: 'NavRouter',
                    type: 'NavRouterAttribute',
                    instance: 'NavRouterInstance',
                },
                {
                    name: 'Navigation',
                    type: 'NavigationAttribute',
                    instance: 'NavigationInstance',
                },
                {
                    name: 'Navigator',
                    type: 'NavigatorAttribute',
                    instance: 'NavigatorInstance',
                },
                {
                    name: 'NodeContainer',
                    type: 'NodeContainerAttribute',
                    instance: 'NodeContainerInstance',
                },
                {
                    name: 'Option',
                    type: 'OptionAttribute',
                    instance: 'OptionInstance',
                },
                {
                    name: 'PageTransitionEnter',
                    type: 'PageTransitionEnterAttribute',
                    instance: 'PageTransitionEnterInstance',
                },
                {
                    name: 'PageTransitionExit',
                    type: 'PageTransitionExitAttribute',
                    instance: 'PageTransitionExitInstance',
                },
                {
                    name: 'Panel',
                    type: 'PanelAttribute',
                    instance: 'PanelInstance',
                },
                {
                    name: 'Particle',
                    type: 'ParticleAttribute',
                    instance: 'ParticleInstance',
                },
                {
                    name: 'Path',
                    type: 'PathAttribute',
                    instance: 'PathInstance',
                },
                {
                    name: 'PatternLock',
                    type: 'PatternLockAttribute',
                    instance: 'PatternLockInstance',
                },
                {
                    name: 'Piece',
                    type: 'PieceAttribute',
                    instance: 'PieceInstance',
                },
                {
                    name: 'PluginComponent',
                    type: 'PluginComponentAttribute',
                    instance: 'PluginComponentInstance',
                },
                {
                    name: 'Polygon',
                    type: 'PolygonAttribute',
                    instance: 'PolygonInstance',
                },
                {
                    name: 'Polyline',
                    type: 'PolylineAttribute',
                    instance: 'PolylineInstance',
                },
                {
                    name: 'Progress',
                    type: 'ProgressAttribute',
                    instance: 'ProgressInstance',
                },
                {
                    name: 'QRCode',
                    type: 'QRCodeAttribute',
                    instance: 'QRCodeInstance',
                },
                {
                    name: 'Radio',
                    type: 'RadioAttribute',
                    instance: 'RadioInstance',
                },
                {
                    name: 'Rating',
                    type: 'RatingAttribute',
                    instance: 'RatingInstance',
                },
                {
                    name: 'Rect',
                    type: 'RectAttribute',
                    instance: 'RectInstance',
                },
                {
                    name: 'RelativeContainer',
                    type: 'RelativeContainerAttribute',
                    instance: 'RelativeContainerInstance',
                },
                {
                    name: 'Refresh',
                    type: 'RefreshAttribute',
                    instance: 'RefreshInstance',
                },
                {
                    name: 'RemoteWindow',
                    type: 'RemoteWindowAttribute',
                    instance: 'RemoteWindowInstance',
                },
                {
                    name: 'RootScene',
                    type: 'RootSceneAttribute',
                    instance: 'RootSceneInstance',
                },
                {
                    name: 'Row',
                    type: 'RowAttribute',
                    instance: 'RowInstance',
                },
                {
                    name: 'RowSplit',
                    type: 'RowSplitAttribute',
                    instance: 'RowSplitInstance',
                },
                {
                    name: 'RichText',
                    type: 'RichTextAttribute',
                    instance: 'RichTextInstance',
                },
                {
                    name: 'Screen',
                    type: 'ScreenAttribute',
                    instance: 'ScreenInstance',
                },
                {
                    name: 'Scroll',
                    type: 'ScrollAttribute',
                    instance: 'ScrollInstance',
                },
                {
                    name: 'ScrollBar',
                    type: 'ScrollBarAttribute',
                    instance: 'ScrollBarInstance',
                },
                {
                    name: 'Search',
                    type: 'SearchAttribute',
                    instance: 'SearchInstance',
                },
                {
                    name: 'Section',
                    type: 'SectionAttribute',
                    instance: 'SectionInstance',
                },
                {
                    name: 'Select',
                    type: 'SelectAttribute',
                    instance: 'SelectInstance',
                },
                {
                    name: 'Shape',
                    type: 'ShapeAttribute',
                    instance: 'ShapeInstance',
                },
                {
                    name: 'Sheet',
                    type: 'SheetAttribute',
                    instance: 'SheetInstance',
                },
                {
                    name: 'SideBarContainer',
                    type: 'SideBarContainerAttribute',
                    instance: 'SideBarContainerInstance',
                },
                {
                    name: 'Slider',
                    type: 'SliderAttribute',
                    instance: 'SliderInstance',
                },
                {
                    name: 'Span',
                    type: 'SpanAttribute',
                    instance: 'SpanInstance',
                },
                {
                    name: 'Stack',
                    type: 'StackAttribute',
                    instance: 'StackInstance',
                },
                {
                    name: 'Stepper',
                    type: 'StepperAttribute',
                    instance: 'StepperInstance',
                },
                {
                    name: 'StepperItem',
                    type: 'StepperItemAttribute',
                    instance: 'StepperItemInstance',
                },
                {
                    name: 'Swiper',
                    type: 'SwiperAttribute',
                    instance: 'SwiperInstance',
                },
                {
                    name: 'SymbolGlyph',
                    type: 'SymbolGlyphAttribute',
                    instance: 'SymbolGlyphInstance',
                },
                {
                    name: 'SymbolSpan',
                    type: 'SymbolSpanAttribute',
                    instance: 'SymbolSpanInstance',
                },
                {
                    name: 'TabContent',
                    type: 'TabContentAttribute',
                    instance: 'TabContentInstance',
                },
                {
                    name: 'Tabs',
                    type: 'TabsAttribute',
                    instance: 'TabsInstance',
                },
                {
                    name: 'Text',
                    type: 'TextAttribute',
                    instance: 'TextInstance',
                },
                {
                    name: 'TextPicker',
                    type: 'TextPickerAttribute',
                    instance: 'TextPickerInstance',
                },
                {
                    name: 'TextClock',
                    type: 'TextClockAttribute',
                    instance: 'TextClockInstance',
                },
                {
                    name: 'TextArea',
                    type: 'TextAreaAttribute',
                    instance: 'TextAreaInstance',
                },
                {
                    name: 'TextInput',
                    type: 'TextInputAttribute',
                    instance: 'TextInputInstance',
                },
                {
                    name: 'TextTimer',
                    type: 'TextTimerAttribute',
                    instance: 'TextTimerInstance',
                },
                {
                    name: 'TimePicker',
                    type: 'TimePickerAttribute',
                    instance: 'TimePickerInstance',
                },
                {
                    name: 'Toggle',
                    type: 'ToggleAttribute',
                    instance: 'ToggleInstance',
                },
                {
                    name: 'Video',
                    type: 'VideoAttribute',
                    instance: 'VideoInstance',
                },
                {
                    name: 'Web',
                    type: 'WebAttribute',
                    instance: 'WebInstance',
                },
                {
                    name: 'WindowScene',
                    type: 'WindowSceneAttribute',
                    instance: 'WindowSceneInstance',
                },
                {
                    name: 'XComponent',
                    type: 'XComponentAttribute',
                    instance: 'XComponentInstance',
                },
                {
                    name: 'GridRow',
                    type: 'GridRowAttribute',
                    instance: 'GridRowInstance',
                },
                {
                    name: 'GridCol',
                    type: 'GridColAttribute',
                    instance: 'GridColInstance',
                },
                {
                    name: 'WaterFlow',
                    type: 'WaterFlowAttribute',
                    instance: 'WaterFlowInstance',
                },
                {
                    name: 'FlowItem',
                    type: 'FlowItemAttribute',
                    instance: 'FlowItemInstance',
                },
                {
                    name: 'ImageSpan',
                    type: 'ImageSpanAttribute',
                    instance: 'ImageSpanInstance',
                },
                {
                    name: 'LocationButton',
                    type: 'LocationButtonAttribute',
                    instance: 'LocationButtonInstance',
                },
                {
                    name: 'PasteButton',
                    type: 'PasteButtonAttribute',
                    instance: 'PasteButtonInstance',
                },
                {
                    name: 'SaveButton',
                    type: 'SaveButtonAttribute',
                    instance: 'SaveButtonInstance',
                },
                {
                    name: 'UIExtensionComponent',
                    type: 'UIExtensionComponentAttribute',
                    instance: 'UIExtensionComponentInstance',
                },
                {
                    name: 'IsolatedComponent',
                    type: 'IsolatedComponentAttribute',
                    instance: 'IsolatedComponentInstance',
                },
                {
                    name: 'RichEditor',
                    type: 'RichEditorAttribute',
                    instance: 'RichEditorInstance',
                },
                {
                    name: 'Component3D',
                    type: 'Component3DAttribute',
                    instance: 'Component3DInstance',
                },
                {
                    name: 'ContainerSpan',
                    type: 'ContainerSpanAttribute',
                    instance: 'ContainerSpanInstance',
                },
            ],
        },
        styles: {
            decorator: 'Styles',
            component: {
                name: 'Common',
                type: 'T',
                instance: 'CommonInstance',
            },
            property: 'stateStyles',
        },
        concurrent: {
            decorator: 'Concurrent',
        },
        customComponent: 'CustomComponent',
        syntaxComponents: {
            paramsUICallback: ['ForEach', 'LazyForEach'],
            attrUICallback: [
                {
                    name: 'Repeat',
                    attributes: ['each', 'template'],
                },
            ],
        },
        libs: [],
    },
};
exports.COMPONENT_FOR_EACH = 'ForEach';
exports.COMPONENT_LAZY_FOR_EACH = 'LazyForEach';
exports.BUILDIN_SYSTEM_COMPONENT = new Set([...exports.ETS_COMPILER_OPTIONS.ets.components, exports.COMPONENT_FOR_EACH, exports.COMPONENT_LAZY_FOR_EACH]);
exports.BUILDIN_ATOMIC_COMPONENT = new Set([
    'AbilityComponent',
    'AlphabetIndexer',
    'Animator',
    'Blank',
    'CalendarPicker',
    'Camera',
    'Circle',
    'Component3D',
    'ContentSlot',
    'Divider',
    'Ellipse',
    'EmbeddedComponent',
    'FormComponent',
    'FrictionMotion',
    'GeometryView',
    'Image',
    'ImageAnimator',
    'ImageSpan',
    'Line',
    'LoadingProgress',
    'LocationButton',
    'Marquee',
    'MediaCachedImage',
    'NodeContainer',
    'PageTransitionEnter',
    'PageTransitionExit',
    'Particle',
    'PasteButton',
    'Path',
    'PatternLock',
    'Polygon',
    'Polyline',
    'Progress',
    'Radio',
    'Rect',
    'RemoteWindow',
    'RichEditor',
    'RichText',
    'SaveButton',
    'ScrollMotion',
    'Search',
    'Slider',
    'Span',
    'SpringMotion',
    'SpringProp',
    'SymbolSpan',
    'SymbolGlyph',
    'TextArea',
    'TextInput',
    'UIExtensionComponent',
    'Video',
    'Web',
]);
exports.COMPONENT_DECORATOR = new Set(['Reusable', 'Component', 'ComponentV2', 'CustomDialog']);
exports.ENTRY_DECORATOR = 'Entry';
exports.BUILDER_DECORATOR = 'Builder';
exports.BUILDER_PARAM_DECORATOR = 'BuilderParam';
exports.COMPONENT_BEHAVIOR = 'Behavior';
function isEtsAtomicComponent(name) {
    return exports.BUILDIN_ATOMIC_COMPONENT.has(name);
}
function isEtsSystemComponent(name) {
    return exports.BUILDIN_SYSTEM_COMPONENT.has(name);
}
function isEtsContainerComponent(name) {
    return isEtsSystemComponent(name) && !isEtsAtomicComponent(name);
}
exports.COMPONENT_CREATE_FUNCTION = 'create';
exports.COMPONENT_POP_FUNCTION = 'pop';
exports.COMPONENT_CUSTOMVIEW = 'View';
exports.COMPONENT_REPEAT = 'Repeat';
exports.COMPONENT_IF = 'If';
exports.COMPONENT_IF_BRANCH = 'IfBranch';
exports.COMPONENT_BRANCH_FUNCTION = 'branch';
exports.COMPONENT_BUILD_FUNCTION = 'build';
exports.SPECIAL_CONTAINER_COMPONENT = new Set([exports.COMPONENT_IF, exports.COMPONENT_IF_BRANCH, exports.COMPONENT_CUSTOMVIEW, exports.COMPONENT_REPEAT]);
exports.COMPONENT_COMMON = 'Common';
exports.COMPONENT_INSTANCE = 'Instance';
exports.COMPONENT_ATTRIBUTE = 'Attribute';
exports.CALL_BACK = 'Callback';
exports.ON_OFF = new Set(['on', 'off']);
exports.OH_PACKAGE_JSON5 = 'oh-package.json5';
exports.BUILD_PROFILE_JSON5 = 'build-profile.json5';
exports.COMPONENT = 'Component';
//# sourceMappingURL=EtsConst.js.map