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

@Component
@Reusabel
export struct SelfDepends {
    @State item: number = 0;
    private datasource: MyDataSource = new MyDataSource();

    build() {
        Column() {
            Text('N' + this.item)
                .fontSize(12)
                .height('16')
            WaterFlow() {
                LazyForEach(this.datasource, (item: number) => {
                    FlowItem() {
                        SelfDepends({item: item})
                    }
                    .width('100%')
                }, (item: string) => item)
            }
            .cachedCount(2)
        }
    }
}

class MyDataSource implements IDataSource {
    
}