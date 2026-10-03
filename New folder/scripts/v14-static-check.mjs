import fs from 'node:fs'; import path from 'node:path';
const root=process.cwd(); const files=['server.js','seller.js','support.js','app.js','auth.js','product.js','admin.js','motion.js','seller.html','support.html']; const missing=files.filter(f=>!fs.existsSync(path.join(root,f))); if(missing.length){console.error('Missing',missing);process.exit(1)} console.log('V14 static file check PASS');
