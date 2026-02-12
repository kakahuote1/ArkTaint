/*
 * Copyright (c) 2024 Huawei Device Co., Ltd.
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

declare interface TextOverflowOptions {


    overflow: TextOverflow;
}


interface TextInterface {


    (content?: string | Resource, value?: TextOptions): TextAttribute;
}


declare class TextAttribute extends CommonMethod<TextAttribute> {


    font(value: Font): TextAttribute;


    font(fontValue: Font, options?: FontSettingOptions): TextAttribute;


    fontColor(value: ResourceColor): TextAttribute;


    fontSize(value: number | string | Resource): TextAttribute;


    minFontSize(value: number | string | Resource): TextAttribute;


    maxFontSize(value: number | string | Resource): TextAttribute;


    minFontScale(scale: number | Resource): TextAttribute;


    maxFontScale(scale: number | Resource): TextAttribute;


    fontStyle(value: FontStyle): TextAttribute;


    fontWeight(value: number | FontWeight | string): TextAttribute;


    fontWeight(weight: number | FontWeight | string, options?: FontSettingOptions): TextAttribute;


    lineSpacing(value: LengthMetrics): TextAttribute;


    textAlign(value: TextAlign): TextAttribute;


    lineHeight(value: number | string | Resource): TextAttribute;


    textOverflow(options: TextOverflowOptions): TextAttribute;


    fontFamily(value: string | Resource): TextAttribute;


    maxLines(value: number): TextAttribute;


    decoration(value: DecorationStyleInterface): TextAttribute;


    letterSpacing(value: number | string): TextAttribute;


    textCase(value: TextCase): TextAttribute;


    baselineOffset(value: number | string): TextAttribute;


    copyOption(value: CopyOptions): TextAttribute;


    draggable(value: boolean): TextAttribute;


    textShadow(value: ShadowOptions | Array<ShadowOptions>): TextAttribute;


    heightAdaptivePolicy(value: TextHeightAdaptivePolicy): TextAttribute;


    textIndent(value: Length): TextAttribute;


    wordBreak(value: WordBreak): TextAttribute;


    lineBreakStrategy(strategy: LineBreakStrategy): TextAttribute;


    onCopy(callback: (value: string) => void): TextAttribute;


    selection(selectionStart: number, selectionEnd: number): TextAttribute;


    ellipsisMode(value: EllipsisMode): TextAttribute;


    enableDataDetector(enable: boolean): TextAttribute;


    dataDetectorConfig(config: TextDataDetectorConfig): TextAttribute;


    bindSelectionMenu(spanType: TextSpanType, content: CustomBuilder, responseType: TextResponseType,
                      options?: SelectionMenuOptions): TextAttribute;


    onTextSelectionChange(callback: (selectionStart: number, selectionEnd: number) => void): TextAttribute;


    fontFeature(value: string): TextAttribute;


    privacySensitive(supported: boolean): TextAttribute;


    textSelectable(mode: TextSelectableMode): TextAttribute;


    editMenuOptions(editMenu: EditMenuOptions): TextAttribute;


    halfLeading(halfLeading: boolean): TextAttribute;


    enableHapticFeedback(isEnabled: boolean): TextAttribute;
}


declare const TextInstance: TextAttribute;


declare const Text: TextInterface;


declare enum TextSpanType {


    TEXT = 0,


    IMAGE = 1,


    MIXED = 2,
}


declare enum TextResponseType {


    RIGHT_CLICK = 0,


    LONG_PRESS = 1,


    SELECT = 2,
}


declare interface TextOptions {


    controller: TextController;
}


declare class TextController {


    closeSelectionMenu(): void;


    setStyledString(value: StyledString): void;


    getLayoutManager(): LayoutManager;
}
