import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import * as lucide from "lucide-react";

const names = new Set(["Circle"]);
for (const file of readdirSync("src").filter(
  (file) => /\.tsx?$/.test(file) && file !== "icons.ts",
)) {
  const source = readFileSync(`src/${file}`, "utf8");
  for (const match of source.matchAll(/["']([A-Z][A-Za-z0-9]*)["']/g)) {
    if (match[1] in lucide) names.add(match[1]);
  }
}
const list = [...names].sort();
writeFileSync(
  "src/icons.ts",
  `// Explicit imports keep unused icons out of the production bundle.\n// Regenerate with: node scripts/optimize-icons.mjs\nimport { ${list.join(", ")} } from 'lucide-react';\nimport type { LucideIcon } from 'lucide-react';\nexport const iconSet: Record<string, LucideIcon> = { ${list.join(", ")} };\n`,
);
console.log(`Registered ${list.length} icons.`);
