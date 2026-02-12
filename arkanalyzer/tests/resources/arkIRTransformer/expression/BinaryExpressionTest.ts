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

let a = 0;
let b = 0;

let c = (a + b) / (a - b);
let d = a & b;
let e = (a || b) && a;

let f = a ** b;
f = a / b;
f = a + b;
f = a - b;
f = a * b;
f = a % b;

f = a << b;
f = a >> b;
f = a >>> b;

f = a & b;
f = a | b;
f = a ^ b;

let g = a < b;
g = a <= b;
g = a > b;
g = a >= b;
g = a == b;
g = a != b;
g = a === b;
g = a !== b;

let h = true;
h = g && h;
h = g || h;
