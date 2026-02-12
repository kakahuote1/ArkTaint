"use strict";
/*
 * Copyright (c) 2024-2025 Huawei Device Co., Ltd.
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.JsonPrinter = void 0;
const Printer_1 = require("../Printer");
const JsonSerialization_1 = require("./JsonSerialization");
class JsonPrinter extends Printer_1.Printer {
    constructor(arkFile) {
        super();
        this.arkFile = arkFile;
    }
    dump() {
        const dto = (0, JsonSerialization_1.serializeArkFile)(this.arkFile);
        return JSON.stringify(dto, null, 2);
    }
}
exports.JsonPrinter = JsonPrinter;
//# sourceMappingURL=JsonPrinter.js.map