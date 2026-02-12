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

function identity(x: number) : number {
    let y:number = x;
    return y;
}

function nonZero() : number {
    return 1;
}

function zero() : number {
    let z = nonZero()
    return 0;
}

function fun(x:number){
    console.log(x)
}

function  main(x:number,y:number) {
    let n = new num();
    n.n=1;
    x = n.get();
}

function func1(a:number,b:number){
    if (a == 0){
        b = 1;
        return b;
    }
    if (b != 0){
        return a;
    }
    return 0;
}

function main1(){
    let x = func1(1,0)
}

class num {
    n:number = 0;
    constructor() {
        this.n=1;
    }
    get():number {
        return -1;
    }
}

class one extends num {
    get(): number {
        return 1;
    }
}

class Zero extends num {
    get(): number {
        return 0;
    }
}

function main2(a:Zero, b:num, c:one) {
    let x = c.get();
    x = x/x;
    x = b.get();
    x = x/x;
    x = 1;
    x = x/x;
    x = a.get();
    x = x/x;
    let n : num = new num();
    let y = n.get();
    y = y/y;
    
}

function func3(){}

function main3(){
    let x = 0;
    func3();
}
