/*
 * Copyright (c) 2025 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License"); * you may not use this file except in compliance with the License.
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
class A {
  y:number;

  foo(x: number): number {
    return 2;
  }
}

function test1(): number {
  let a = new A();
  let x = a.y;
  a.y = 20;
  x = a.foo(x);

  if (a.y > 15) {
    x = 30;
  } else {
    a.y = 40;
  }

  let z = x + a.y;
  return z;
}

function test2(input: number): void {
    let x = 1;
    let y = 2;
    let z = 3;
    do {
        x = x + 1;
        if(input > 0) {
            y = x;
        } else {
            z = z * 2;
            y = x + 1;
        }
        z = x + y;
    } while (z < 10);
    z = x * y;
}

