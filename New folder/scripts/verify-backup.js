import fs from 'node:fs';
import path from 'node:path';
const file=process.argv[2]||process.env.BACKUP_FILE;
if(!file){console.error('Usage: node scripts/verify-backup.js /path/to/backup.sql');process.exit(1)}
const stat=fs.statSync(file);if(stat.size<100){console.error('Backup is suspiciously small.');process.exit(1)}
const sample=fs.readFileSync(file,{encoding:'utf8',length:4096});
const markers=['PostgreSQL database dump','CREATE TABLE','COPY '];
const hits=markers.filter(x=>sample.includes(x));
console.log({file:path.resolve(file),sizeBytes:stat.size,markersFound:hits});
process.exit(hits.length>=2?0:1);
