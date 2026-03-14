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

/**
 * LottiePlayer组件提供动画加载与控制播放能力
 * @since 8
 * @design
 */
export default class LottiePlayer {

    /**
     * 通过动画名称控制, 播放动画
     * @param name 被指定的动画名, 同loadAnimation接口参数name, 缺省时播放所有动画
     * @since 8
     * @design
     */
    play(name?: string): void;

    /**
     * 通过动画名称控制，暂停动画
     * @param name 被指定的动画名, 同loadAnimation接口入参name, 缺省时暂停所有动画
     * @since 8
     * @design
     */
    pause(name?: string): void;

    /**
     * 通过动画名称控制，停止动画
     * @param name 被指定的动画名, 同loadAnimation接口参数name, 缺省时停止所有动画
     * @since 8
     * @design
     */
    stop(name?: string): void;

    /**
     * 通过动画名称控制，设置播放速度
     * @param name 被指定的动画名, 同loadAnimation接口参数name, 缺省时设置所有动画速度
     * @param speed 值为浮点类型, speed>0正向播放, speed<0反向播放, speed=0暂停播放, speed=1.0/-1.0正常速度播放
     * @since 8
     * @design
     */
    setSpeed(speed: number, name?: string): void;

    /**
     * 通过动画名称控制，设置播放方向
     * @param name 被指定的动画名, 同loadAnimation接口参数name, 缺省时设置所有动画方向
     * @param direction 1为正向, -1为反向; 当设置为反向时, 从当前播放进度开始回播直到首帧, loop值为true时可无限倒放, speed<0叠加时也是倒放
     * @since 8
     * @design
     */
    setDirection(direction: AnimationDirection, name?: string): void;

    /**
     * 通过动画名称控制，暂停或播放动画
     * @param name 被指定的动画名, 同loadAnimation接口参数name, 缺省时停止所有动画
     * @since 8
     * @design
     */
    togglePause(name?: string): void

    /**
     * 加载动画, 须在组件完成布局后调用, 如可在点击事件回调中及Canvas组件的onReady()生命周期回调内调用;
     * 页面退出时, 须与destory()配对使用;
     * 目前支持canvas渲染方式, 支持传入json动画资源路径或json格式动画数据;
     * 声明式范式下可配合组件生命周期onPageShow()使用, web范式下可配合生命周期onShow()使用;
     * @param params 详见AnimationConfigWithPath或AnimationConfigWithData的声明
     * @return AnimationItem 动画对象, 可控制动画播放。
     * @since 9
     * @design
     */
    loadAnimation(params: AnimationConfigWithPath | AnimationConfigWithData): AnimationItem;

    /**
     * 通过动画名称控制, 销毁动画; 声明式范式下可配合组件生命周期onDisappear()与onPageHide()使用, web范式下可配合配合生命周期onHide()使用
     * @param name 被指定的动画名, 同loadAnimation接口参数name, 缺省时销毁所有动画
     * @since 8
     * @design
     */
    destroy(name?: string): void;
}


