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

namespace Case1 {
  @Component
  struct Child {
    @Builder customBuilder() { }
    @BuilderParam customBuilderParam: () => void = this.customBuilder;

    build() {
      Column() {
        this.customBuilderParam()
      }
    }
  }

  @Entry
  @Component
  struct BuilderParamTest {
    @Builder componentBuilder() {
      Text(`Parent builder `)
    }

    build() {
      Column() {
        Child({ customBuilderParam: this.componentBuilder })
      }
    }
  }
}

namespace Case2 {
  @Component
  struct Child {
    label: string = `Child`
    @Builder customBuilder() { }
    @Builder customChangeThisBuilder() { }
    @BuilderParam customBuilderParam: () => void = this.customBuilder;
    @BuilderParam customChangeThisBuilderParam: () => void = this.customChangeThisBuilder;

    build() {
      Column() {
        this.customBuilderParam()
        this.customChangeThisBuilderParam()
      }
    }
  }

  @Entry
  @Component
  struct BuilderParamTest {
    label: string = `Parent`

    @Builder componentBuilder() {
      Text(`${this.label}`)
    }

    build() {
      Column() {
        this.componentBuilder()
        Child({ customBuilderParam: this.componentBuilder, customChangeThisBuilderParam: (): void => { this.componentBuilder() } })
      }
    }
  }
}

namespace Case3 {
  class Tmp {
    label: string = ''
  }
  @Builder function overBuilder($$: Tmp) {
    Text($$.label)
      .width(400)
      .height(50)
      .backgroundColor(Color.Green)
  }

  @Component
  struct Child {
    label: string = 'Child'
    @Builder customBuilder() { }
    @BuilderParam customBuilderParam: () => void = this.customBuilder;
    @BuilderParam customOverBuilderParam: ($$: Tmp) => void = overBuilder;

    build() {
      Column() {
        this.customBuilderParam()
        this.customOverBuilderParam({ label: 'global Builder label' })
      }
    }
  }

  @Entry
  @Component
  struct BuilderParamTest {
    label: string = 'Parent'

    @Builder componentBuilder() {
      Text(`${this.label}`)
    }

    build() {
      Column() {
        this.componentBuilder()
        Child({ customBuilderParam: this.componentBuilder, customOverBuilderParam: overBuilder })
      }
    }
  }
}


@Component
struct CustomContainer {
  @Prop header: string = '';
  @Builder closerBuilder(){ }
  @BuilderParam closer: () => void = this.closerBuilder

  build() {
    Column() {
      Text(this.header)
        .fontSize(30)
      this.closer()
    }
  }
}

@Builder function specificParam(label1: string, label2: string) {
  Column() {
    Text(label1)
      .fontSize(30)
    Text(label2)
      .fontSize(30)
  }
}

@Entry
@Component
struct BuilderParamTest {
  @State text: string = 'header';

  build() {
    Column() {
      CustomContainer({ header: this.text }) {
        Column() {
          specificParam('testA', 'testB')
        }.backgroundColor(Color.Yellow)
          .onClick(() => {
            this.text = 'changeHeader';
          })
      }
    }
  }
}
