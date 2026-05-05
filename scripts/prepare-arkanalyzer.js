const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const sourceRoot = path.join(repoRoot, "arkanalyzer", "src");
const outRoot = path.join(repoRoot, "arkanalyzer", "out", "src");
const allowedExtensions = new Set([".js", ".map", ".ts", ".json"]);

function isDeclarationFile(filePath) {
    return filePath.endsWith(".d.ts");
}

function shouldCopy(filePath) {
    if (isDeclarationFile(filePath)) return true;
    const ext = path.extname(filePath);
    if (ext === ".ts") return false;
    return allowedExtensions.has(ext);
}

function copyCompiledArtifacts(srcDir, dstDir) {
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
        const srcPath = path.join(srcDir, entry.name);
        const dstPath = path.join(dstDir, entry.name);
        if (entry.isDirectory()) {
            copyCompiledArtifacts(srcPath, dstPath);
            continue;
        }
        if (!entry.isFile() || !shouldCopy(srcPath)) {
            continue;
        }
        fs.mkdirSync(path.dirname(dstPath), { recursive: true });
        fs.copyFileSync(srcPath, dstPath);
    }
}

if (!fs.existsSync(sourceRoot)) {
    throw new Error(`arkanalyzer source artifact root not found: ${sourceRoot}`);
}

fs.rmSync(outRoot, { recursive: true, force: true });
copyCompiledArtifacts(sourceRoot, outRoot);

if (!fs.existsSync(path.join(outRoot, "Scene.js")) || !fs.existsSync(path.join(outRoot, "Scene.d.ts"))) {
    throw new Error(`arkanalyzer out generation incomplete: ${outRoot}`);
}

console.log("prepared arkanalyzer/out/src from arkanalyzer/src compiled artifacts");
