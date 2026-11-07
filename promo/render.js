const {chromium}=require('playwright');const fs=require('fs');
const [,,mode]=process.argv;
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:540,height:960}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto('file://'+__dirname+'/promo.html');await p.evaluate(()=>window.ready);
const save=async(t,f)=>{const d=await p.evaluate(t=>window.frame(t),t);fs.writeFileSync(f,Buffer.from(d.split(',')[1],'base64'));};
if(mode==='preview'){for(const t of [1.4,4.5,7.3,8.6,11.6,14.5])await save(t,`prev_${t}.jpg`);}
else{fs.mkdirSync('frames',{recursive:true});for(let i=0;i<450;i++)await save(i/30,`frames/f${String(i).padStart(4,'0')}.jpg`);}
console.log('errors',errs);await b.close();})();
