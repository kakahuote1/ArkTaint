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
  class Tmp {
    paramA1: string = ''
  }

  @Builder function overBuilder(params: Tmp) {
    Row() {
      Text(`UseStateVarByReference: ${params.paramA1} `)
    }
  }

  @Component
  struct AppIcon {
    @State bundleName: string;
    @State message: string;
    x: string = '';

    build() {
      Row() {
        Text(this.bundleName)
        Text(this.x = this.message)
      }
    }
  }

  @Entry
  @Component
    struct BuilderTest {
    @State label: string = 'Hello';
    @State height: number = 10;
    @State bundleName: string = 'test';
    @State scale: number = 10;
    @State animateScale: number = 1.0;
    @State lastAppInfo: Object | null = null;

    @Builder
    appInfoBuilder() {
      AppIcon({
        bundleName: this.bundleName,
        message: this.lastAppInfo?.message
      }).height(this.height)
    }

    build() {
      Column() {
        this.appInfoBuilder()
        // Pass the this.label reference to the overBuilder component when the overBuilder component is called in the Parent component.
        overBuilder({ paramA1: this.label })
        Button('Click me').onClick(() => {
          // After Click me is clicked, the UI text changes from Hello to ArkUI.
          this.label = 'ArkUI';
        })
      }.scale({y: this.scale * this.animateScale})
    }
  }
}

namespace Case2 {
  class Tmp {
    paramA1: string = ''
  }

  @Builder function overBuilder($$: Tmp) {
    Row() {
      Column() {
        Text(`overBuilder===${$$.paramA1}`)
        HelloComponent({ message: $$.paramA1 })
      }
    }
  }

  @Component
  struct HelloComponent {
    @Link message: string;

    build() {
      Row() {
        Text(`HelloComponent===${this.message}`)
      }
    }
  }

  @Entry
  @Component
  struct BuilderTest {
    @State label: string = 'Hello';
    build() {
      Column() {
        // Pass the this.label reference to the overBuilder component when the overBuilder component is called in the Parent component.
        overBuilder({ paramA1: this.label })
        Button('Click me').onClick(() => {
          // After Click me is clicked, the UI text changes from Hello to ArkUI.
          this.label = 'ArkUI';
        })
      }
    }
  }
}

namespace Case3 {
  @Builder function overBuilder(paramA1: string) {
    Row() {
      Text(`UseStateVarByValue: ${paramA1} `)
    }
  }
  @Entry
  @Component
  struct BuilderTest {
    @State label: string = 'Hello';
    build() {
      Column() {
        overBuilder(this.label)
      }
    }
  }
}

class Tmp {
  paramA1: string = '';
}

@Builder function parentBuilder($$: Tmp) {
  Row() {
    Column() {
      Text(`parentBuilder===${$$.paramA1}`)
        .fontSize(30)
        .fontWeight(FontWeight.Bold)
      HelloComponent({ message: $$.paramA1 })
      childBuilder({ paramA1: $$.paramA1 })
    }
  }
}

@Component
struct HelloComponent {
  @Prop message: string = '';

  build() {
    Row() {
      Text(`HelloComponent===${this.message}`)
        .fontSize(30)
        .fontWeight(FontWeight.Bold)
    }
  }
}

@Builder
function childBuilder($$: Tmp) {
  Row() {
    Column() {
      Text(`childBuilder===${$$.paramA1}`)
        .fontSize(30)
        .fontWeight(FontWeight.Bold)
      HelloChildComponent({ message: $$.paramA1 })
      grandsonBuilder({ paramA1: $$.paramA1 })
    }
  }
}

@Component
struct HelloChildComponent {
  @State message: string = '';
  build() {
    Row() {
      Text(`HelloChildComponent===${this.message}`)
        .fontSize(30)
        .fontWeight(FontWeight.Bold)
    }
  }
}

@Builder function grandsonBuilder($$: Tmp) {
  Row() {
    Column() {
      Text(`grandsonBuilder===${$$.paramA1}`)
        .fontSize(30)
        .fontWeight(FontWeight.Bold)
      HelloGrandsonComponent({ message: $$.paramA1 })
    }
  }
}

@Component
struct HelloGrandsonComponent {
  @Link message: string;
  build() {
    Row() {
      Text(`HelloGrandsonComponent===${this.message}`)
        .fontSize(30)
        .fontWeight(FontWeight.Bold)
    }
  }

  static build(a: number) {
    if (a) {
      return 1;
    }
  }
}

@Entry
@Component
struct BuilderTest {
  @State label: string = 'Hello';
  build() {
    Column() {
      parentBuilder({ paramA1: this.label })
      Button('Click me').onClick(() => {
        this.label = 'ArkUI';
      })
    }
  }
}

@Builder
function moreRootBuilderTest() {
  Column()
  Column()
}

@Component
struct WaterFlowTest {
  build() {
    Column() {
      WaterFlow({footer: (): void => this.itemFoot()})
    }
  }

  @Builder
  itemFoot() {
    Text('Foot Text')
  }
}

class ViewData {
  index: number

  constructor() {
    this.index = 0;
  }
}

interface TestI {
  n?: number;
}

@Component
struct ComplexStateValueTest {
  @State
  arrayData: string[] = [];
  @State
  viewData: ViewData = new ViewData();
  @State
  n: number = 0;

  build() {
    Column() {
      ComplexView({data: this.arrayData[0], index: this.viewData.index, t: {n: this.n}});
    }
  }
}

@Component 
struct ComplexView {
  @State
  data: string = '';
  @State
  index: number = 0;
  @State
  t: TestI = {}

  build() {
    Column() {
      Text(`${this.data}`)
      Text(`${this.index}`)
    }
  }
}