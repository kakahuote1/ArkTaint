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

@Entry
@Component
struct IfElseTest3 {
  @State count: number = 0;

  build() {
    Column() {
      Text(`count=${this.count}`)

      this.testIfText();

      Button('increase count')
        .onClick(() => {
          this.count++;
        })

      Button('decrease count')
        .onClick(() => {
          this.count--;
        })
    }
  }

  @Builder
  testIfText() {
    if (this.count > 0) {
      Text(`count is positive`)
        .fontColor(Color.Green)
    } else {
      Text(`count is negative`)
        .fontColor(Color.Green)
    }
  }
}