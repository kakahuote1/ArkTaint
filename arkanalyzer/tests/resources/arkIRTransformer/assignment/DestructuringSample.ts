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

let [d1, d2] = [7, 8];
const { d3, d4 } = { d3: 1, d4: 2 };
const { d5: d7, d6: d8 } = { d5: 1, d6: 2 };
let d9 = 0;
let d10 = 0;
[d9, d10] = [7, 8];
({ d11: d9, d12: d10 } = { d11: 1, d12: 2 });