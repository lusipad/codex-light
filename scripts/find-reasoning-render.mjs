import fs from "node:fs";

const code = fs.readFileSync(".ref/scratch/app-shared-a906948d8868.js", "utf8");

// 搜索所有出现 reasoning 的地方，如果附近有 jsx、className、component、render 等
let idx = 0;
while ((idx = code.indexOf("reasoning", idx + 1)) !== -1) {
  const snippet = code.slice(Math.max(0, idx - 100), Math.min(code.length, idx + 200));
  if (snippet.includes("className") || snippet.includes("jsx") || snippet.includes("children") || snippet.includes("createElement")) {
    console.log("=== REASONING UI ===");
    console.log(snippet.replace(/\n/g, " "));
  }
}
