import * as fs from "fs";
import * as path from "path";

interface HygieneTarget {
    path: string;
    forbiddenPatterns: RegExp[];
}

const HYGIENE_TARGETS: HygieneTarget[] = [
    {
        path: "src/core/entry/arkmain/facts/ArkMainFactResolverUtils.ts",
        forbiddenPatterns: [
            /includes\(\s*["'`](Ability|Extension|Stage|Want|want|router|Router)["'`]\s*\)/,
            /indexOf\(\s*["'`](Ability|Extension|Stage|Want|want|router|Router)["'`]\s*\)/,
            /\.toLowerCase\s*\(/,
        ],
    },
    {
        path: "src/core/entry/arkmain/facts/ArkMainLifecycleFactResolver.ts",
        forbiddenPatterns: [
            /includes\(\s*["'`](Ability|Extension|Stage|Want|want|router|Router)["'`]\s*\)/,
            /indexOf\(\s*["'`](Ability|Extension|Stage|Want|want|router|Router)["'`]\s*\)/,
            /\.toLowerCase\s*\(/,
        ],
    },
    {
        path: "src/core/entry/arkmain/facts/ArkMainCallbackFactResolver.ts",
        forbiddenPatterns: [
            /includes\(\s*["'`](Ability|Extension|Stage|Want|want|router|Router)["'`]\s*\)/,
            /indexOf\(\s*["'`](Ability|Extension|Stage|Want|want|router|Router)["'`]\s*\)/,
            /\.toLowerCase\s*\(/,
        ],
    },
    {
        path: "src/core/entry/arkmain/facts/ArkMainChannelFactResolver.ts",
        forbiddenPatterns: [
            /includes\(\s*["'`](Ability|Extension|Stage|Want|want|router|Router)["'`]\s*\)/,
            /indexOf\(\s*["'`](Ability|Extension|Stage|Want|want|router|Router)["'`]\s*\)/,
            /\.toLowerCase\s*\(/,
        ],
    },
    {
        path: "src/core/entry/arkmain/facts/ArkMainChannelHandoffFactResolver.ts",
        forbiddenPatterns: [
            /includes\(\s*["'`](Ability|Extension|Stage|Want|want|router|Router)["'`]\s*\)/,
            /indexOf\(\s*["'`](Ability|Extension|Stage|Want|want|router|Router)["'`]\s*\)/,
            /\.toLowerCase\s*\(/,
        ],
    },
    {
        path: "src/core/entry/arkmain/facts/ArkMainReactiveFactResolver.ts",
        forbiddenPatterns: [
            /includes\(\s*["'`](Ability|Extension|Stage|Want|want|router|Router)["'`]\s*\)/,
            /indexOf\(\s*["'`](Ability|Extension|Stage|Want|want|router|Router)["'`]\s*\)/,
            /\.toLowerCase\s*\(/,
        ],
    },
    {
        path: "src/core/entry/arkmain/facts/ArkMainSchedulerFactResolver.ts",
        forbiddenPatterns: [
            /includes\(\s*["'`](Ability|Extension|Stage|Want|want|router|Router)["'`]\s*\)/,
            /indexOf\(\s*["'`](Ability|Extension|Stage|Want|want|router|Router)["'`]\s*\)/,
            /\.toLowerCase\s*\(/,
        ],
    },
    {
        path: "src/tests/helpers/PureEntryOracle.ts",
        forbiddenPatterns: [
            /includes\(\s*["'`](Ability|Extension|Stage|Want|want|router|Router)["'`]\s*\)/,
            /indexOf\(\s*["'`](Ability|Extension|Stage|Want|want|router|Router)["'`]\s*\)/,
            /\.toLowerCase\s*\(/,
        ],
    },
];

function findViolations(target: HygieneTarget): string[] {
    const absPath = path.resolve(target.path);
    const source = fs.readFileSync(absPath, "utf8");
    const lines = source.split(/\r?\n/);
    const violations: string[] = [];

    for (const pattern of target.forbiddenPatterns) {
        for (let index = 0; index < lines.length; index++) {
            if (!pattern.test(lines[index])) continue;
            violations.push(`${target.path}:${index + 1}: ${lines[index].trim()}`);
        }
    }

    return violations;
}

async function main(): Promise<void> {
    const violations = HYGIENE_TARGETS.flatMap(findViolations);
    if (violations.length > 0) {
        throw new Error(
            `Entry-model rule hygiene violations found:\n${violations.join("\n")}`,
        );
    }

    console.log("PASS test_entry_model_rule_hygiene");
    console.log(`targets=${HYGIENE_TARGETS.length}`);
}

main().catch(error => {
    console.error("FAIL test_entry_model_rule_hygiene");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});

