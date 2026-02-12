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

class Util {
    public static staticField1: number = 1;
    public static staticField2: number[] = [1, 2, 3, 4, 5];
    public instanceField1: number = 2;

    public static staticFunc1(): void {
    }

    public static staticFunc2(n: number): number {
        return n;
    }

    public static async staticFunc3(n: number): Promise<number> {
        return n;
    }

    public instanceFunc1(): void {
    }

    public instanceFunc2(n: number): number {
        return n;
    }

    public async instanceFunc3(n: number): Promise<number> {
        return n;
    }
}

class Sample {
    public async testOperandOriginalPositions(): Promise<void> {
        const util = new Util();
        util.instanceFunc1();
        util.instanceFunc2(1);
        let i = util.instanceFunc2(1);
        i = await util.instanceFunc3(1);
        util.instanceField1 = 2;

        Util.staticFunc1();
        Util.staticFunc2(2);
        i = Util.staticFunc2(2);
        i = await Util.staticFunc3(2);
        Util.staticField1 = 1;
        Util.staticField2[0] = 1;
    }
}
