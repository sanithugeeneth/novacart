import 'dotenv/config';
const base=(process.env.PUBLIC_BASE_URL||`http://localhost:${process.env.PORT||3000}`).replace(/\/$/,'');
const count=Math.max(1,Math.min(200,Number(process.env.LOAD_TEST_REQUESTS||50)));
const concurrency=Math.max(1,Math.min(25,Number(process.env.LOAD_TEST_CONCURRENCY||10)));
let next=0,failed=0,total=0,start=Date.now();
async function worker(){while(true){const i=next++;if(i>=count)return;try{const r=await fetch(`${base}/api/products?limit=12&page=1`);if(!r.ok)failed++;}catch{failed++;}total++;}}
await Promise.all(Array.from({length:concurrency},()=>worker()));
const ms=Date.now()-start;console.log(JSON.stringify({base,requests:total,failed,concurrency,durationMs:ms,requestsPerSecond:Number((total/(ms/1000)).toFixed(2))},null,2));process.exit(failed?1:0);
