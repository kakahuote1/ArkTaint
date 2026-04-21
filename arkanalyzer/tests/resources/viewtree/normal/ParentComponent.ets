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
struct ParentComponent {
    @State countDownStartValue: number = 10 // 10 Nuggets default start value in a Game
    build() {
        Column() {
            Text(`Grant ${this.countDownStartValue} nuggets to play.`)
            Button() {
                Text('+1 - Nuggets in New Game')
            }.onClick(() => {
                this.countDownStartValue += 1
            })
            Button() {
                Text('-1  - Nuggets in New Game')
            }.onClick(() => {
                this.countDownStartValue -= 1
            })
            // when creatng ChildComponent, the initial value of its @Prop variable must be supplied
            // in a named constructor parameter
            // also regular costOfOneAttempt (non-Prop) variable is initialied
            CountDownComponent({ count: this.countDownStartValue, costOfOneAttempt: 2})
        }
    }
}

@Component
struct CountDownComponent {
    @Prop count: number
    private costOfOneAttempt: number
    build() {
        Column() {
            if (this.count > 0) {
                Text(`You have ${this.count} Nuggets left`)
            } else {
                Text('Game over!')
            }
            Button() {
                Text('Try again')
            }.onClick(() => {
                this.count -= this.costOfOneAttempt
            })
        }
    }
}