import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import {providerJSON,enabled,IntegrationError} from './provider-http.js';

export function parseImage(value) {
  if(typeof value!=='string')throw new IntegrationError('Choose a JPEG, PNG or WebP image.',400);
  const match=/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if(!match||match[2].length>4*1024*1024)throw new IntegrationError('Choose a JPEG, PNG or WebP image under 3 MB.',400);
  const buffer=Buffer.from(match[2],'base64');
  if(buffer.length<12||buffer.length>3*1024*1024||buffer.toString('base64')!==match[2])throw new IntegrationError('The image is invalid or too large.',400);
  const mime=buffer.subarray(0,3).equals(Buffer.from([255,216,255]))?'jpeg':buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'png':buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP'?'webp':'';
  if(mime!==match[1])throw new IntegrationError('The image content does not match its file type.',400);
  return match[2];
}
export function registerVisualSearch({app,pool,env,fetcher=fetch,getSession,csrfOk}) {
  const available=enabled(env.ENABLE_VISUAL_SEARCH)&&Boolean(env.GOOGLE_VISION_API_KEY);
  const limiter=rateLimit({windowMs:60*60*1000,limit:10,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Image search limit reached. Please try again later.'}});
  app.get('/api/visual-search/config',(_req,res)=>res.json({enabled:available,provider:available?'Google Cloud Vision':null,maxBytes:3*1024*1024}));
  app.post('/api/visual-search',limiter,async(req,res)=>{
    try {
      if(!available)throw new IntegrationError('Image search is not configured. You can search by name instead.',503);
      req.session=await getSession(req);
      if(req.session&&!csrfOk(req))throw new IntegrationError('Invalid CSRF token.',403);
      if(req.body?.consent!==true)throw new IntegrationError('Confirm that you want to send this image to Google Cloud Vision for analysis.',400);
      const content=parseImage(req.body?.image);
      const rawBudget=Number(env.VISUAL_SEARCH_DAILY_LIMIT||200);
      const budget=Number.isInteger(rawBudget)&&rawBudget>0?Math.min(rawBudget,10000):200;
      const count=await pool.query(`insert into integration_usage(service,day,requests) values('vision',current_date,1) on conflict(service,day) do update set requests=integration_usage.requests+1 where integration_usage.requests<$1 returning requests`,[budget]);
      if(!count.rowCount)throw new IntegrationError('Image search has reached today’s limit. Please search by name.',429);
      const response=await providerJSON(fetcher,'https://vision.googleapis.com/v1/images:annotate',{method:'POST',headers:{'content-type':'application/json','x-goog-api-key':env.GOOGLE_VISION_API_KEY},body:JSON.stringify({requests:[{image:{content},features:[{type:'LABEL_DETECTION',maxResults:15},{type:'OBJECT_LOCALIZATION',maxResults:10}]}]})});
      const result=response.responses?.[0];
      if(!result||result.error)throw new IntegrationError('The image could not be analyzed. Try a clearer product photo.');
      const annotations=[...(result.localizedObjectAnnotations||[]).map(x=>({term:x.name,weight:x.score})),...(result.labelAnnotations||[]).map(x=>({term:x.description,weight:x.score}))];
      const labels=new Map();
      const generic=new Set(['product','font','line','rectangle','material','wood','white','black','grey','gray','photo','photograph','photography','image','design','pattern','art','object']);
      for(const annotation of annotations) {
        const term=String(annotation.term||'').toLowerCase().trim();const weight=Number(annotation.weight);
        if(term.length<3||term.length>70||!Number.isFinite(weight)||weight<0.65||generic.has(term))continue;
        if(!labels.has(term)||labels.get(term)<weight)labels.set(term,weight);
      }
      const terms=[...labels].slice(0,20).map(([term,weight])=>({term,weight,pattern:'%'+term.replace(/[\\%_]/g,'\\$&')+'%'}));
      let products=[];
      if(terms.length) {
        const matches=await pool.query(`select p.id,p.title,p.cat,p.image,p.price,p.currency,p.rating,p.reviews,p.stock,
          sum(l.weight*(case when p.title ilike l.pattern then 3 else 1 end))::numeric as score
          from products p join jsonb_to_recordset($1::jsonb) as l(term text,weight numeric,pattern text)
          on p.title ilike l.pattern or p.cat ilike l.pattern or p.search_keywords ilike l.pattern or p.description ilike l.pattern or p.brand ilike l.pattern
          where p.active=true group by p.id order by score desc,p.id limit 24`,[JSON.stringify(terms)]);
        products=matches.rows.map(p=>({...p,price:Number(p.price),rating:Number(p.rating),score:Number(p.score)}));
      }
      // No image, base64 payload, or provider token is persisted.
      await pool.query('insert into visual_searches(id,user_id,image_url,query_text,provider,results) values($1,$2,$3,$4,$5,$6)',[crypto.randomUUID(),req.session?.uid||null,'',terms.map(t=>t.term).join(', ').slice(0,240),'google-cloud-vision',JSON.stringify(products.map(p=>p.id))]);
      return res.json({provider:'google-cloud-vision',labels:terms.map(({term,weight})=>({label:term,confidence:weight})),results:products,message:products.length?'Products matching the objects recognized in your photo.':'No matching products found. Try another photo or search by name.'});
    } catch(error) {
      return res.status(error.status||503).json({error:error instanceof IntegrationError?error.message:'Image search is temporarily unavailable.'});
    }
  });
}
