const sharp = require('sharp'); const fs=require('fs'); const path=require('path');
const dir=process.argv[2], out=process.argv[3];
fs.mkdirSync(out,{recursive:true});
(async()=>{
for (const f of fs.readdirSync(dir).filter(f=>f.endsWith('.svg'))) {
  try { await sharp(path.join(dir,f),{density:120}).resize(520).png().toFile(path.join(out,f.replace('.svg','.png'))); }
  catch(e){ console.log('skip',f,e.message); }
}
console.log('done');
})();
