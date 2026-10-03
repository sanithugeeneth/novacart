import 'dotenv/config';
const base=(process.env.PUBLIC_BASE_URL||`http://localhost:${process.env.PORT||3000}`).replace(/\/$/,'');
const checks=['/api/health','/api/ready','/api/store-config','/robots.txt','/sitemap.xml','/','/login.html','/product.html','/admin.html'];
let failed=0;
for(const path of checks){try{const r=await fetch(base+path);console.log(`${r.ok?'PASS':'FAIL'} ${r.status} ${path}`);if(!r.ok)failed++;}catch(e){console.log(`FAIL ${path} ${e.message}`);failed++;}}
process.exit(failed?1:0);
