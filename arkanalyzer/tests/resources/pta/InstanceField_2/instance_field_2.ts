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

namespace instance_field_2 {
    class InstanceField2 {
        private field: Object;
    
        constructor() {
            this.field = {};
        }
    
        static main(): void {
            InstanceField2.entry1();
            InstanceField2.entry2();
        }
    
        static entry1(): void {
            new InstanceField2().f();
        }
    
        static entry2(): void {
            new InstanceField2().f();
        }
    
        private f(): void {
            this.field = new Object();
            this.g();
        }
    
        private g(): void {
            const local: Object = this.field;
        }
    }

    function main() {
        InstanceField2.main();
    }

}