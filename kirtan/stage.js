import * as T from '../logo/three.module.js';
import { mergeGeometries } from './vendor/BufferGeometryUtils.js';
import { createPandal } from './pandal.js';
import { loadCharacters } from './characters.js';

function batchStatic(scene){
  scene.updateMatrixWorld(true);const groups=new Map(),originals=[];
  scene.traverse(object=>{if(object.isMesh&&!object.isInstancedMesh){const geometry=object.geometry.index?object.geometry.toNonIndexed():object.geometry.clone();geometry.applyMatrix4(object.matrixWorld);const list=groups.get(object.material)||[];list.push(geometry);groups.set(object.material,list);originals.push(object);}});
  originals.forEach(object=>object.removeFromParent());
  for(const [material,list]of groups){const mesh=new T.Mesh(mergeGeometries(list),material);mesh.castShadow=mesh.receiveShadow=true;scene.add(mesh);list.forEach(geometry=>geometry.dispose());}
}

export async function createWorld(container,onProgress){
  const mobile=innerWidth<700,renderer=new T.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,mobile?1.25:1.6));renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.06;container.append(renderer.domElement);
  const scene=new T.Scene();scene.fog=new T.Fog('#a27045',25,60);
  scene.add(new T.HemisphereLight('#ffe0a6','#664027',2));
  const sun=new T.DirectionalLight('#ffe4b6',2.8);sun.position.set(-6,6,8);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.radius=3;Object.assign(sun.shadow.camera,{left:-10,right:10,top:10,bottom:-10});sun.shadow.normalBias=.025;scene.add(sun);
  const fill=new T.DirectionalLight('#f8ac9b',1.3);fill.position.set(7,4,1);scene.add(fill);
  const {lights}=createPandal(scene);batchStatic(scene);
  const camera=new T.PerspectiveCamera(43,1,.1,90),target=new T.Vector3(.35,1.45,0);let radius=mobile?10.8:11.5,azimuth=.10,polar=1.46;
  function look(){camera.position.set(target.x+radius*Math.sin(polar)*Math.sin(azimuth),target.y+radius*Math.cos(polar),target.z+radius*Math.sin(polar)*Math.cos(azimuth));camera.lookAt(target);}
  function resize(){const width=container.clientWidth,height=container.clientHeight;renderer.setSize(width,height);camera.aspect=width/height;camera.fov=width<700?49:43;camera.updateProjectionMatrix();look();renderer.render(scene,camera);}
  const observer=new ResizeObserver(resize);observer.observe(container);resize();
  const pointers=new Map();let previousDistance=0;
  renderer.domElement.addEventListener('pointerdown',event=>{pointers.set(event.pointerId,[event.clientX,event.clientY]);renderer.domElement.setPointerCapture(event.pointerId);previousDistance=0;});
  renderer.domElement.addEventListener('pointermove',event=>{
    const previous=pointers.get(event.pointerId);if(!previous)return;pointers.set(event.pointerId,[event.clientX,event.clientY]);
    if(pointers.size===2){const [a,b]=[...pointers.values()],distance=Math.hypot(a[0]-b[0],a[1]-b[1]);if(previousDistance)radius=T.MathUtils.clamp(radius+(previousDistance-distance)*.018,4.5,20);previousDistance=distance;}
    else {azimuth-=(event.clientX-previous[0])*.004;polar=T.MathUtils.clamp(polar+(event.clientY-previous[1])*.0025,1.22,1.55);}
    look();
  });
  for(const event of ['pointerup','pointercancel','lostpointercapture'])renderer.domElement.addEventListener(event,e=>{pointers.delete(e.pointerId);previousDistance=0;});
  renderer.domElement.addEventListener('wheel',event=>{event.preventDefault();radius=T.MathUtils.clamp(radius+event.deltaY*.01,4.5,20);look();},{passive:false});
  const characters=await loadCharacters(scene,onProgress);
  let reduced=false,frames=0;
  const state={characters:characters.actors.length,modelErrors:characters.errors,mode:'idle',frame:0};
  renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();container.dispatchEvent(new CustomEvent('world-error'));});
  return {state,setReduced(value){reduced=value;},update(dt,time,audio){
    const mode=audio.playing&&!reduced?audio.mode:'idle';characters.update(dt,audio,reduced);
    for(const light of lights)light.material.opacity=reduced?1:Math.min(1,.8+audio.energy*.5+Math.sin(time*1.3)*.05);
    renderer.render(scene,camera);frames++;
    Object.assign(state,{mode,frame:frames,playing:audio.playing,energy:audio.energy,drawCalls:renderer.info.render.calls,camera:camera.position.toArray(),characterClips:characters.actors.map(actor=>actor.currentName)});
  },dispose(){observer.disconnect();renderer.dispose();scene.traverse(o=>{o.geometry?.dispose();});}};
}
