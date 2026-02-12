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

// delete operator
let p = new Point();
delete p.y;

// void operator
let a = 0;
void a;
let b = 1;
void (a + b);

// await operator
await 10;
const x = await 11;

// yield operator
yield 20;

// instanceof operator
let isCat = cat instanceof Cat;

// type assertion
let foo1 = bar as Foo;
let foo2 = <Foo>bar;