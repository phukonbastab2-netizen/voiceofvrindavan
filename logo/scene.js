import * as T from './three.module.js';
const embed=new URLSearchParams(location.search).has('embed');if(embed)document.body.classList.add('embed');
const motionPreference=matchMedia('(prefers-reduced-motion: reduce)');let reduced=motionPreference.matches;
const stage=document.querySelector('#stage');
try {
const shapes=await fetch('./shapes.json').then(r=>{if(!r.ok)throw Error('Logo unavailable');return r.json()});
const renderer=new T.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(Math.max(devicePixelRatio,1.5),2));renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.2;stage.append(renderer.domElement);
const scene=new T.Scene(),camera=new T.PerspectiveCamera(34,1,.1,150);camera.position.z=21;
const logo=new T.Group();scene.add(logo);
// Environment light cards give the metal broad, photographic reflections.
const studio=new T.Scene();studio.background=new T.Color('#807d70');
for(const [x,y,z,w,h,power] of [[-3,3,10,8,8,1.8],[-8,8,7,8,14,4],[9,2,5,4,13,3],[0,-8,3,18,2,2],[0,10,-4,16,5,4]]){const m=new T.Mesh(new T.PlaneGeometry(w,h),new T.MeshBasicMaterial({color:new T.Color(power,power*.97,power*.9),side:T.DoubleSide}));m.position.set(x,y,z);m.lookAt(0,0,0);studio.add(m)}
const pm=new T.PMREMGenerator(renderer);scene.environment=pm.fromScene(studio,.035).texture;pm.dispose();
scene.add(new T.AmbientLight(0xfff0d2,1));const key=new T.DirectionalLight(0xfff4df,3.2);key.position.set(-3,4,8);scene.add(key);const rim=new T.DirectionalLight(0xffffff,2.4);rim.position.set(6,-2,3);scene.add(rim);
const gold=new T.MeshStandardMaterial({color:0xe2b24f,metalness:.82,roughness:.22,envMapIntensity:1.35});const side=new T.MeshStandardMaterial({color:0xb88638,metalness:.8,roughness:.25,envMapIntensity:1.45});
function path(points,Type){return new Type(points.map(([x,y])=>new T.Vector2((x-908)/100,(446-y)/100)))}
const parts=[];for(const s of shapes){const shape=path(s.outer,T.Shape);shape.holes=s.holes.map(p=>path(p,T.Path));const geo=new T.ExtrudeGeometry(shape,{depth:.085,bevelEnabled:true,bevelThickness:.016,bevelSize:.0065,bevelSegments:4,steps:1,curveSegments:12});geo.computeBoundingBox();const center=geo.boundingBox.getCenter(new T.Vector3());geo.translate(-center.x,-center.y,-center.z);const mesh=new T.Mesh(geo,[gold,side]);mesh.userData.center=center;mesh.position.copy(center);logo.add(mesh);parts.push(mesh)}
if(embed){for(const m of parts){const c=m.userData.center;const icon=c.x < -4.5;m.userData.baseScale=icon?.85:.45;if(icon){c.x=(c.x+5.95)*.85;c.y=c.y*.85+.45;}else{c.x=(c.x-1.45)*.45;c.y=c.y*.45-2.7;}}}
const dustGeo=new T.BufferGeometry(),dust=[];let seed=36;function rand(){seed=(seed*1664525+1013904223)>>>0;return seed/4294967296}for(let i=0;i<240;i++)dust.push((rand()-.5)*35,(rand()-.5)*18,-3-rand()*9);dustGeo.setAttribute('position',new T.Float32BufferAttribute(dust,3));const dustMat=new T.PointsMaterial({color:0xd8b56a,size:.026,transparent:true,opacity:.45,depthWrite:false});const particles=new T.Points(dustGeo,dustMat);scene.add(particles);
// Fine elliptical halos suggest resonance around the original emblem.
const halo=new T.Group();scene.add(halo);for(let i=0;i<3;i++){const pts=[];for(let j=0;j<=180;j++){const a=j/180*Math.PI*2;pts.push(new T.Vector3(Math.cos(a)*(3.05+i*.19),Math.sin(a)*(3.05+i*.19),0))}const line=new T.Line(new T.BufferGeometry().setFromPoints(pts),new T.LineBasicMaterial({color:0xbba56a,transparent:true,opacity:.095-i*.022}));line.rotation.y=.4+i*.2;halo.add(line)}halo.position.set(embed?0:-5.95,embed?.45:0,-.4);if(embed)halo.scale.setScalar(.9);
let time=reduced?7:0,paused=reduced,last=performance.now(),px=0,py=0,visible=!document.hidden,dirty=true;
const ease=x=>1-Math.pow(1-Math.max(0,Math.min(1,x)),3);
function resize(){const w=stage.clientWidth,h=stage.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.position.z=Math.max(embed?16:19,(embed?4.1:8.25)/(Math.tan(17*Math.PI/180)*camera.aspect));camera.updateProjectionMatrix();dirty=true}resize();addEventListener('resize',resize);
addEventListener('pointermove',e=>{if(paused||reduced)return;px=(e.clientX/innerWidth-.5)*.12;py=(e.clientY/innerHeight-.5)*.07});document.addEventListener('visibilitychange',()=>{visible=!document.hidden;last=performance.now();dirty=true});
const pause=document.querySelector('#pause');function pauseLabel(){pause.textContent=paused?'Play':'Pause';pause.setAttribute('aria-label',paused?'Play logo animation':'Pause logo animation');pause.setAttribute('aria-pressed',String(paused))}pauseLabel();pause.onclick=()=>{paused=!paused;last=performance.now();dirty=true;pauseLabel()};document.querySelector('#replay').onclick=()=>{time=reduced?7:0;paused=reduced;dirty=true;pauseLabel()};
motionPreference.addEventListener('change',e=>{reduced=e.matches;if(reduced){time=7;paused=true;px=0;py=0}dirty=true;pauseLabel()});
function frame(now){requestAnimationFrame(frame);const dt=Math.min((now-last)/1000,.05);last=now;if(!visible||(paused&&!dirty))return;if(!paused)time+=dt;dirty=false;
 const intro=ease(time/4);logo.rotation.y=(1-intro)*-.7+(reduced?0:Math.sin(time*.23)*.045+px);logo.rotation.x=(1-intro)*.08+(reduced?0:py);logo.position.y=reduced?0:Math.sin(time*.4)*.035;
 parts.forEach((m,i)=>{const p=ease((time-i*.042)/2.7),c=m.userData.center;m.position.set(c.x,c.y-(1-p)*.3,c.z+(1-p)*2.6);m.scale.setScalar((m.userData.baseScale||1)*(.7+.3*p));m.rotation.y=(1-p)*-.45});
 key.position.x=-5+Math.sin(time*.38)*9;particles.rotation.z=time*.007;halo.rotation.z=time*.018;
 renderer.render(scene,camera);document.body.classList.add('ready');window.__logoReady=true;
}requestAnimationFrame(frame);
}catch(e){console.error(e);document.querySelector('#hint').textContent='Original logo · 3D is unavailable on this device';document.querySelector('.controls').hidden=true;}
