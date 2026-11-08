const {chromium}=require('playwright');const fs=require('fs');
const [,,v,mode,dur]=process.argv;
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1000,height:1000}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto('file://'+__dirname+'/banner.html?v='+v+'&d='+(dur||7));await p.evaluate(()=>window.ready);
const save=async(t,f)=>{const d=await p.evaluate(t=>window.frame(t),t);fs.writeFileSync(f,Buffer.from(d.split(',')[1],'base64'));};
if(mode==='still'){await save(3,`banner-${v}.png`);}
else{const dir='bframes-'+v;fs.rmSync(dir,{recursive:true,force:true});fs.mkdirSync(dir);const N=Math.round((+dur||7)*30);for(let i=0;i<N;i++)await save(i/30,`${dir}/f${String(i).padStart(4,'0')}.png`);}
console.log('errors',errs);await b.close();})();
