import assert from "node:assert/strict";
import fs from "node:fs";

// 1. 检查组件文件存在
const components = [
  "HotkeyWindow.tsx",
  "LibraryView.tsx",
  "ImagesView.tsx",
  "GptsView.tsx",
  "SitesView.tsx",
  "CloudEnvironmentsView.tsx",
];

for (const comp of components) {
  const filePath = new URL(`../src/components/${comp}`, import.meta.url);
  assert.ok(fs.existsSync(filePath), `Component file must exist: ${comp}`);
}

// 2. 检查 App.tsx 路由接线
const appSource = fs.readFileSync(
  new URL("../src/App.tsx", import.meta.url),
  "utf8"
);

assert.ok(appSource.includes("<ImagesView"), "App.tsx must render ImagesView");
assert.ok(appSource.includes("<GptsView"), "App.tsx must render GptsView");
assert.ok(appSource.includes("<SitesView"), "App.tsx must render SitesView");
assert.ok(appSource.includes("<LibraryView"), "App.tsx must render LibraryView");
assert.ok(
  appSource.includes("<CloudEnvironmentsView"),
  "App.tsx must render CloudEnvironmentsView"
);
assert.ok(
  appSource.includes("<HotkeyWindow"),
  "App.tsx must render HotkeyWindow"
);

// 3. 检查 NavigationRail.tsx 包含对应入口
const navSource = fs.readFileSync(
  new URL("../src/components/NavigationRail.tsx", import.meta.url),
  "utf8"
);

assert.ok(navSource.includes('"projects"'), "NavigationRail must include projects");
assert.ok(navSource.includes('"worktrees"'), "NavigationRail must include worktrees");
assert.ok(navSource.includes('"sites"'), "NavigationRail must include sites");
assert.ok(navSource.includes('"library"'), "NavigationRail must include library");
assert.ok(navSource.includes('"images"'), "NavigationRail must include images");
assert.ok(navSource.includes('"gpts"'), "NavigationRail must include gpts");
assert.ok(
  navSource.includes('"cloud-environments"'),
  "NavigationRail must include cloud-environments"
);

console.log("ALL EXTENDED WORKSURFACES (17-23) VERIFICATIONS PASSED!");
