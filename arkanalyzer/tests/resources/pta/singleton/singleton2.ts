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

namespace Singleton2 {
    function getWorker() {
        return Worker2.getInstance();
    }

    class Worker2 {
        private static mInstance:Worker2 

        public static getInstance(): Worker2 {
            if (!Worker2.mInstance) {
                Worker2.mInstance= new Worker2()
            }
             return Worker2.mInstance;
        }
    }

    function main() {
        let a = Worker2.getInstance();
        temp()
        temp2();
    }

    function temp() {
        let b = getWorker();
    }

    function temp2() {
        let n = getWorker();
    }
}