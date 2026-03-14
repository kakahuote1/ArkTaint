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

@ObservedV2
class Wrap2 {
  @Trace message: string = '';

  constructor(message: string) {
    this.message = message;
  }
}
@ObservedV2
class Wrap1 {
  @Trace message: Wrap2 = new Wrap2('');

  constructor(message: string) {
    this.message = new Wrap2(message);
  }
}

@Entry
@ComponentV2
struct RepeatTest1 {
  @Local simpleList: Array<Wrap1> = [new Wrap1('one'), new Wrap1('two'), new Wrap1('three')];

  build() {
    Row() {
      Column() {
        Text('')
          .fontSize(24)
          .fontColor(Color.Red)
          .onClick(() => {
            this.simpleList[2].message.message = 'new three';
          })

        Repeat<Wrap1>(this.simpleList)
            .each((obj: RepeatItem<Wrap1>)=>{
              RepeatTestChildItem({ item: obj.item.message.message })
                .margin({top: 20})
            })
            .key((item: Wrap1, index: number) => index.toString())
      }
      .justifyContent(FlexAlign.Center)
      .width('100%')
      .height('100%')
    }
    .height('100%')
    .backgroundColor(0xF1F3F5)
  }
}

@ComponentV2
struct RepeatTestChildItem {
  @Require @Param item: string;
  
  build() {
    Text(this.item)
      .fontSize(30)
  }
}