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

import lottie from '@ohos/lottie';
import { AnimationItem } from '@ohos/lottie';

function testLottie() {
    const anim = lottie.loadAnimation({name:'test'});
}

export default class LottieUtils {

    public static releaseAnimationByObj(animateItems: AnimationItem[]){
        for (let item of animateItems) {
            item.destroy();
        }
    }

    public static releaseAnimationByName(animateNames: string[]){
        for (let name of animateNames) {
            lottie.destroy(name);
        }
    }
}

@Entry
@Component
struct MyComponent {
    @State w:number = 150
    @State inputValue: string = '159'
    build(){
        Column({ space: this.inputValue });
    }

    func1(){
        animateTo({curve: Curve.Sharp, duration: 1000}, () => {
          this.w = (this.w === 80 ? 150 : 80);
        });
    }
}

@Entry
@Component
struct BlurEffectsExample {
    build(){
        Column({ space: 10 }) {

            Text('Image blur').fontSize(15).fontColor(0xCCCCCC).width('90%');
            Image('resources/base/media/sss001.jpg').blur(1)
            .border({ width: 1 }).borderStyle(BorderStyle.Dashed).aspectRatio(1).width('90%').height(40);


            Text('backdropBlur').fontSize(15).fontColor(0xCCCCCC).width('90%');
            Text()
            .fontSize(16)
            .itemStyle()
            .itemTextStyle()
            .textAnimatable()
            .backdropBlur(3)
            .backgroundImage('/pages/attrs/image/image.jpg')
            .backgroundImageSize({ width: 1200, height: 160 });
        }.width('100%').margin({ top: 5 });
    }
}

@Styles
function itemStyle() {
  .width(336)
  .height(621)
}

@Extend(Text)
function itemTextStyle() {
    .fontWeight(500)
    .opacity(0.4)
}

@AnimatableExtend(Text)
function textAnimatable() {
    .maxLines(500)
}

function testArrayMap():void {
    const arr = [1,2,3].map(x=>parse(x));
    console.log(arr);
}

function parse(a: number):string {
    return a.toString();
}

class Foo {
    private a = {
        b: {
            c: function () {},
        }
    }

    func(): void {
        setTimeout(this.a.b.c.bind(this),1);
    }
}