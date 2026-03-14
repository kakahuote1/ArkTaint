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

// Import statements
import { readFileSync } from 'fs';

// Interface definition
interface Person {
    name: string;
    age: number;
    greet(): string;
}

// Class definition implementing the interface
class Student implements Person {
    name: string;
    age: number;
    grade: number;

    // Constructor with default field
    constructor(name: string, age: number, grade: number = 1) {
        this.name = name;
        this.age = age;
        this.grade = grade;
    }

    // Method implementation
    greet(): string {
        return `Hello, my name is ${this.name} and I am ${this.age} years old.`;
    }

    // Method with non-trivial arithmetic
    calculateGraduationYear(currentYear: number): number {
        const yearsLeft = 12 - this.grade;
        return currentYear + yearsLeft;
    }
}

// Abstract class definition
abstract class Shape {
    abstract area(): number;
    abstract perimeter(): number;

    // Method using abstract methods
    description(): string {
        return `Area: ${this.area()}, Perimeter: ${this.perimeter()}`;
    }
}

// Derived class from abstract class
class Circle extends Shape {
    radius: number;

    constructor(radius: number) {
        super();
        this.radius = radius;
    }

    // Overriding abstract methods
    area(): number {
        return Math.PI * this.radius * this.radius;
    }

    perimeter(): number {
        return 2 * Math.PI * this.radius;
    }
}

/**
 * This function takes two numbers, performs a series of operations,
 * and returns the final result.
 *
 * @param x - The first number
 * @param y - The second number
 * @returns The result of the operations
 */
function simpleFunction(x: number, y: number): number {
    let sum: number = x + y;
    let difference: number = x - y;
    let product: number = x * y;
    let quotient: number = x / y;

    // Conditional statements to modify the result
    if (sum > 100) {
        sum = 100;
    }

    if (difference < 0) {
        difference = 0;
    }

    // Combining results in a non-trivial way
    let result: number = sum + difference + product - quotient;

    return result;
}

// Function with several statements and complex conditional expressions
function complexFunction(a: number, b: number, flag: boolean): number {
    let result: number;

    if (flag) {
        result = a * b + (a - b);
    } else {
        result = a / b - (a + b);
    }

    if (result > 100) {
        result = 100;
    } else if (result < 0) {
        result = 0;
    }

    return result;
}

// Variable bindings and for loops
let sum: number = 0;
for (let i: number = 1; i <= 10; i++) {
    sum += i;
}

// Using the imported readFileSync function (dummy use for illustration)
const fileContent: string = readFileSync('dummy.txt', 'utf8');

// Function to use complex type expressions
function processInput(input: string | number): string {
    if (typeof input === 'string') {
        return `String input: ${input}`;
    } else if (typeof input === 'number') {
        return `Number input: ${input}`;
    }
    return `Unknown input`;
}

// Export statements
export { Person, Student, Shape, Circle, simpleFunction, complexFunction, sum, fileContent, processInput };
