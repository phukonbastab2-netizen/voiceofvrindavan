import * as T from '../logo/three.module.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';

/** Optional owner-supplied models. Empty configuration is a valid, model-free stage. */
export async function loadCharacters(scene, onProgress) {
  const actors=[],errors=[];
  try {
    const response=await fetch('/kirtan/characters.json');
    if(!response.ok)throw new Error('Character configuration unavailable');
    const config=await response.json();
    if(!Array.isArray(config.characters))throw new Error('characters must be an array');
    if(config.characters.length>20)throw new Error('Use at most twenty characters in this prototype');
    const loader=new GLTFLoader();
    for(const [index,item]of config.characters.entries()){
      try {
        if(typeof item.url!=='string'||new URL(item.url,location.href).origin!==location.origin)throw new Error('Use a local model file');
        onProgress?.(`Preparing character ${index+1} of ${config.characters.length}`);
        const data=await loader.loadAsync(item.url),model=data.scene,rig=new T.Group(),fit=new T.Group();
        fit.add(model);rig.add(fit);
        const mixer=new T.AnimationMixer(model),actions={};
        for(const mode of ['idle','dance','clap','kirtan']){
          const requested=item.clips?.[mode]||mode;
          const clip=data.animations.find(c=>c.name.toLowerCase()===requested.toLowerCase());
          if(clip)actions[mode]=mixer.clipAction(clip);
        }
        if(actions.idle){actions.idle.play();mixer.update(0);}
        model.updateMatrixWorld(true);model.traverse(o=>{if(o.isSkinnedMesh){o.skeleton.update();o.computeBoundingBox();}if(o.isMesh)o.castShadow=o.receiveShadow=true;});
        const bounds=new T.Box3().setFromObject(model),size=bounds.getSize(new T.Vector3()),center=bounds.getCenter(new T.Vector3());
        if(!Number.isFinite(size.y)||size.y<=0)throw new Error('Model has no visible geometry');
        const height=Number(item.height??2.65);
        if(!Number.isFinite(height)||height<.1||height>8)throw new Error('Character height must be between 0.1 and 8 scene units');
        const scale=height/size.y;fit.scale.setScalar(scale);fit.position.set(-center.x*scale,-bounds.min.y*scale,-center.z*scale);
        const position=item.position??[0,.21,0];
        if(!Array.isArray(position)||position.length!==3||!position.every(Number.isFinite))throw new Error('Use a numeric x, y, z position');
        rig.position.fromArray(position);rig.rotation.y=Number(item.rotationY)||0;scene.add(rig);
        actors.push({rig,mixer,actions,current:actions.idle||null,currentName:'idle',referenceBpm:Math.max(30,Number(item.animationBpm)||100)});
      } catch(error) { errors.push(`Character ${index+1}: ${error.message}`); }
    }
  } catch(error) {errors.push(error.message);}
  return {actors,errors,update(dt,audio,reduced){
    for(const actor of actors){
      const desired=audio.playing&&!reduced?audio.mode:'idle';
      const next=actor.actions[desired]||actor.actions.idle;
      if(next&&next!==actor.current){actor.current?.fadeOut(.45);next.reset().fadeIn(.45).play();actor.current=next;actor.currentName=desired;}
      if(!reduced){
        if(next&&audio.playing&&desired!=='idle'){
          next.setEffectiveTimeScale(0);next.time=(audio.beat*60/actor.referenceBpm)%next.getClip().duration;
        }else next?.setEffectiveTimeScale(.5);
        actor.mixer.update(Math.min(dt,.2));
      }
    }
  }};
}
