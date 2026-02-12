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

class Dummy{}                                                                                                                                                                                               

function log(): void {
    console.log("Drawing a shape.");
}

// Define the abstract class 'Shape' with an abstract draw method.
abstract class Shape {
    public abstract draw(d:Dummy): void;
}

// Define 'Circle' class that implements 'Shape'.
class Circle extends Shape {
    obj: Dummy;
    draw(d: Dummy): void {
        log();
        this.obj = d;
    }   
}

// Define 'Rectangle' class that implements 'Shape'.
class Rectangle extends Shape {
    draw(d: Dummy): void {
    }   
}

// Identity function that returns the input Shape.
function id(t: Shape): Shape {
    return t;
}

function main () {
    let d = new Dummy();
    const c = new Circle();
    c.draw(d);
    const b1 = id(c);
    b1.draw(d);
}
