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

namespace static_field {
    class B {
    }
    
    class A {
        static b: B;  // 在 TypeScript 中明确指定静态字段的类型
    }
    
    function main(): void {
        A.b = new B();  // 给 A 类的静态字段 b 赋一个新的 B 实例
        const b: B = A.b;  // 从 A 类获取静态字段 b 并存储到局部变量 b
    }    
}