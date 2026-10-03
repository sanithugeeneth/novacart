import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs/promises';
export async function database(){
 const db=new PGlite();await db.waitReady;
 const schema=(await fs.readFile(new URL('../schema.sql',import.meta.url),'utf8')).replace('create extension if not exists pgcrypto;','');
 await db.exec(schema);await db.exec(schema);
 let tail=Promise.resolve();
 async function acquire(){let release;const ready=tail;tail=new Promise(r=>release=r);await ready;return release;}
 const query=async(sql,params=[])=>{const r=await db.query(sql,params);return {...r,rowCount:r.rows.length||r.affectedRows||0};};
 return {db,async query(sql,params){const release=await acquire();try{return await query(sql,params)}finally{release()}},async connect(){let held=await acquire();return {async query(sql,params){let temporary=false;if(!held){held=await acquire();temporary=!/^begin/i.test(sql);}try{return await query(sql,params)}finally{if(temporary||/^(commit|rollback)/i.test(sql)){held?.();held=null;}}},release(){held?.();held=null;}};},async end(){await db.close()}};
}
