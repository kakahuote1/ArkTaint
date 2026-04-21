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

declare type DrawableDescriptor = import ('../api/@ohos.arkui.drawableDescriptor').DrawableDescriptor;


declare type DrawingColorFilter = import('../api/@ohos.graphics.drawing').default.ColorFilter;


declare type ResolutionQuality = import('../api/@ohos.multimedia.image').default.ResolutionQuality;


declare type DrawingLattice = import('../api/@ohos.graphics.drawing').default.Lattice;


declare enum ImageRenderMode {


    Original,


    Template,
}


declare enum ImageContent {

    EMPTY = 0,
}


declare enum DynamicRangeMode {

    HIGH = 0,


    CONSTRAINT = 1,


    STANDARD = 2,
}


declare enum ImageInterpolation {


    None,


    Low,


    Medium,


    High,
}


interface ImageInterface {


    (src: PixelMap | ResourceStr | DrawableDescriptor): ImageAttribute;


    (src: PixelMap | ResourceStr | DrawableDescriptor | ImageContent): ImageAttribute;


    (src: PixelMap | ResourceStr | DrawableDescriptor, imageAIOptions: ImageAIOptions): ImageAttribute;
}


declare class ImageAttribute extends CommonMethod<ImageAttribute> {


    alt(value: string | Resource | PixelMap): ImageAttribute;


    matchTextDirection(value: boolean): ImageAttribute;


    fitOriginalSize(value: boolean): ImageAttribute;


    fillColor(value: ResourceColor): ImageAttribute;


    objectFit(value: ImageFit): ImageAttribute;


    objectRepeat(value: ImageRepeat): ImageAttribute;


    autoResize(value: boolean): ImageAttribute;


    renderMode(value: ImageRenderMode): ImageAttribute;


    dynamicRangeMode(value: DynamicRangeMode): ImageAttribute;


    interpolation(value: ImageInterpolation): ImageAttribute;


    sourceSize(value: { width: number; height: number }): ImageAttribute;


    syncLoad(value: boolean): ImageAttribute;


    colorFilter(value: ColorFilter | DrawingColorFilter): ImageAttribute;


    copyOption(value: CopyOptions): ImageAttribute;


    draggable(value: boolean): ImageAttribute;


    pointLight(value: PointLightStyle): ImageAttribute;


    edgeAntialiasing(value: number): ImageAttribute;


    onComplete(
        callback: (event?: {


            width: number;


            height: number;


            componentWidth: number;


            componentHeight: number;


            loadingStatus: number;


            contentWidth: number;


            contentHeight: number;


            contentOffsetX: number;


            contentOffsetY: number;
        }) => void,
    ): ImageAttribute;


    onError(callback: ImageErrorCallback): ImageAttribute;


    onFinish(event: () => void): ImageAttribute;


    enableAnalyzer(enable: boolean): ImageAttribute;


    analyzerConfig(config: ImageAnalyzerConfig): ImageAttribute;


    resizable(value: ResizableOptions): ImageAttribute;


    privacySensitive(supported: boolean): ImageAttribute;


    enhancedImageQuality(imageQuality: ResolutionQuality): ImageAttribute;
}


declare const Image: ImageInterface;


declare const ImageInstance: ImageAttribute;


type ImageErrorCallback = (error: ImageError) => void;


declare interface ImageError {


    componentWidth: number;


    componentHeight: number;


    message: string
}


declare interface ResizableOptions {


    slice?: EdgeWidths;


    lattice?: DrawingLattice;
}
