import {
    runMetamorphicSuite,
    TransformOutput,
    TransformSpec,
} from "./metamorphic/MetamorphicHarness";

const transforms: TransformSpec[] = [
    {
        name: "sink_parenthesize_arg",
        apply(sourceCode: string): TransformOutput {
            const sinkPattern = /taint\.Sink\(([^)]+)\);/;
            const sinkMatch = sourceCode.match(sinkPattern);
            if (!sinkMatch) {
                return { code: sourceCode, changed: false };
            }

            const argExpr = sinkMatch[1].trim();
            const code = sourceCode.replace(sinkPattern, `taint.Sink(((${argExpr})));`);
            return { code, changed: code !== sourceCode };
        },
    },
    {
        name: "cond_to_ternary_assign",
        apply(sourceCode: string): TransformOutput {
            const ifElseAssign =
                /if\s*\(([^)]+)\)\s*\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^;]+);\s*\}\s*else\s*\{\s*\2\s*=\s*([^;]+);\s*\}/m;
            const m = sourceCode.match(ifElseAssign);
            if (!m) {
                return { code: sourceCode, changed: false };
            }

            const cond = m[1].trim();
            const varName = m[2].trim();
            const trueExpr = m[3].trim();
            const falseExpr = m[4].trim();
            const replacement = `${varName} = (${cond}) ? ${trueExpr} : ${falseExpr};`;
            const code = sourceCode.replace(ifElseAssign, replacement);
            return { code, changed: code !== sourceCode };
        },
    },
    {
        name: "map_set_reorder",
        apply(sourceCode: string): TransformOutput {
            const mapSetPair =
                /([A-Za-z_][A-Za-z0-9_]*)\.set\("token",\s*([^)]+)\)\s*;\s*\1\.set\("safe",\s*([^)]+)\)\s*;/m;
            const m = sourceCode.match(mapSetPair);
            if (!m) {
                return { code: sourceCode, changed: false };
            }

            const table = m[1];
            const tokenExpr = m[2].trim();
            const safeExpr = m[3].trim();
            const replacement = `${table}.set("safe", ${safeExpr});\n  ${table}.set("token", ${tokenExpr});`;
            const code = sourceCode.replace(mapSetPair, replacement);
            return { code, changed: code !== sourceCode };
        },
    },
    {
        name: "relay_arg_parenthesize",
        apply(sourceCode: string): TransformOutput {
            const relayCallPattern = /relay\(([^)]+)\)/;
            const relayMatch = sourceCode.match(relayCallPattern);
            if (!relayMatch) {
                return { code: sourceCode, changed: false };
            }

            const argExpr = relayMatch[1].trim();
            const code = sourceCode.replace(relayCallPattern, `relay(((${argExpr})))`);
            return { code, changed: code !== sourceCode };
        },
    },
];

runMetamorphicSuite({
    defaults: {
        manifestPath: "tests/manifests/metamorphic_seed_v3.list",
        sourceDir: "tests/demo/metamorphic_seed_v2",
        tempProjectDir: "tmp/phase42_v3/metamorphic_project",
        reportPath: "tmp/phase42_v3/metamorphic_report.json",
        k: 1,
    },
    transforms,
    variantTag: "m3",
    skipUnchangedVariants: true,
}).catch(err => {
    console.error(err);
    process.exitCode = 1;
});
