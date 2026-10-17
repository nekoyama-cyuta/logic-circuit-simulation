// assets_starterAssets.json から js/starterAssets.js を生成する:  node tools/build-starter-assets.js
// （file:// で開いたときも fetch なしで標準アセットを読めるようにするため）
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'assets_starterAssets.json'), 'utf8'));
const out = '// 自動生成ファイル（編集しないでください）: node tools/build-starter-assets.js\n'
  + 'window.LogicSimStarterAssets = ' + JSON.stringify(data) + ';\n';
fs.writeFileSync(path.join(root, 'js', 'starterAssets.js'), out);
console.log(`js/starterAssets.js: ${data.length} assets`);
