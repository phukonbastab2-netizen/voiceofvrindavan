import { KirtanAudio, TRACKS } from './audio.js';
import { createWorld } from './stage.js';

const $=id=>document.getElementById(id), audio=new KirtanAudio();
audio.index=2;
const preference=matchMedia('(prefers-reduced-motion: reduce)');
let reduced=preference.matches,world,last=performance.now(),raf,changing=false;
const bars=Array.from({length:8},()=>{const i=document.createElement('i');document.querySelector('.spectrum').append(i);return i;});
const notify=message=>{$('error').textContent=message;$('error').hidden=!message;};
function sync(){
  const t=TRACKS[audio.index];$('track-category').textContent=t.category;$('track-title').textContent=t.name;$('track-description').textContent=t.detail;
  document.body.classList.toggle('playing',audio.playing);$('play').setAttribute('aria-label',audio.playing?'Pause kirtan':'Play kirtan');$('play').setAttribute('aria-pressed',String(audio.playing));
  document.querySelectorAll('.track').forEach((button,i)=>{button.classList.toggle('selected',i===audio.index);button.setAttribute('aria-pressed',String(i===audio.index));});
  $('activity').textContent=audio.playing?{clap:'Gentle bhajan',kirtan:'Kirtan rhythm',dance:'Raas rhythm'}[t.mode]+` · ${t.bpm} BPM`:'The stage is waiting';
}
$('play').onclick=async()=>{if(changing)return;changing=true;try{notify('');if(audio.playing)audio.pause();else await audio.play();sync();}catch(error){notify(error.message);}finally{changing=false;}};
for(const button of document.querySelectorAll('.track'))button.onclick=async()=>{if(changing)return;changing=true;try{notify('');await audio.select(Number(button.dataset.track));sync();}catch(error){notify(error.message);}finally{changing=false;}};
$('volume').oninput=e=>audio.setVolume(Number(e.target.value)/100);
function motion(){world?.setReduced(reduced);$('motion').setAttribute('aria-pressed',String(reduced));$('motion').textContent=reduced?'Enable movement':'Reduce motion';sync();}
$('motion').onclick=()=>{reduced=!reduced;motion();};
preference.addEventListener('change',event=>{reduced=event.matches;motion();});
$('focus').onclick=()=>{const immersive=document.body.classList.toggle('immersed');$('focus').setAttribute('aria-pressed',String(immersive));$('focus').textContent=immersive?'Exit immersion ↙':'Immerse ↗';};
addEventListener('keydown',event=>{if(event.key==='Escape'&&document.body.classList.contains('immersed'))$('focus').click();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){audio.pause();sync();cancelAnimationFrame(raf);}else{last=performance.now();raf=requestAnimationFrame(frame);}});
function frame(now){if(document.hidden)return;const dt=(now-last)/1000;last=now;const state=audio.state;world?.update(dt,now/1000,state);bars.forEach((bar,i)=>bar.style.height=`${3+(state.bars[i]||0)*13}px`);raf=requestAnimationFrame(frame);}
try{
  world=await createWorld($('world'),text=>{$('loading').querySelector('span').textContent=text;});
  window.__kirtan={world:world.state,audio,tracks:TRACKS};
  if(world.state.modelErrors.length)notify('Music is ready, but a character file could not load.');
  document.body.classList.add('ready');setTimeout(()=>$('loading').hidden=true,700);
  $('play').disabled=false;motion();last=performance.now();raf=requestAnimationFrame(frame);
}catch(error){
  console.error(error);$('loading').hidden=true;notify('The 3D courtyard could not open. Check your connection and try a browser with WebGL enabled.');
}
$('world').addEventListener('world-error',()=>{audio.pause();sync();notify('The 3D view was interrupted. Refresh to reopen the courtyard.');});
addEventListener('pagehide',()=>{audio.dispose();cancelAnimationFrame(raf);world?.dispose();});
