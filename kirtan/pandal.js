import * as T from '../logo/three.module.js';

const cache=new Map();
function mat(color,extra={}){const key=color+JSON.stringify(extra);if(!cache.has(key))cache.set(key,new T.MeshStandardMaterial({color,roughness:.72,...extra}));return cache.get(key);}
function add(geo,material,parent,x=0,y=0,z=0){const mesh=new T.Mesh(geo,material);mesh.position.set(x,y,z);mesh.castShadow=mesh.receiveShadow=true;parent.add(mesh);return mesh;}
function patternedFabric(carpet=false){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=1024;const c=canvas.getContext('2d');
  c.fillStyle=carpet?'#9f1730':'#e0a828';c.fillRect(0,0,1024,1024);
  for(let y=0;y<1024;y+=128)for(let x=0;x<1024;x+=128){
    c.save();c.translate(x+64,y+64);c.strokeStyle=carpet?'#df9d45':'#ffe9a2';c.lineWidth=3;c.rotate(Math.PI/4);c.strokeRect(-40,-40,80,80);c.rotate(-Math.PI/4);
    for(let i=0;i<8;i++){c.rotate(Math.PI/4);c.beginPath();c.ellipse(0,14,6,17,0,0,Math.PI*2);c.stroke();}
    c.fillStyle=carpet?'#efc187':'#c27216';c.beginPath();c.arc(0,0,7,0,Math.PI*2);c.fill();c.restore();
  }
  for(let i=0;i<26000;i++){c.fillStyle=i%2?'#fff5c611':'#2303050c';c.fillRect(Math.random()*1024,Math.random()*1024,1,2);}
  const map=new T.CanvasTexture(canvas);map.colorSpace=T.SRGBColorSpace;map.wrapS=map.wrapT=T.RepeatWrapping;return map;
}

export function createPandal(scene){
  const red=mat('#a81737'),gold=mat('#e4b74f',{metalness:.38,roughness:.5}),pink=mat('#b72953'),yellow=mat('#f2b940');
  const carpet=patternedFabric(true);carpet.repeat.set(3,2);
  add(new T.BoxGeometry(30,.15,30),mat('#a2845c'),scene,0,-.25,0);
  add(new T.BoxGeometry(11,.36,7.5),red,scene,0,.02,0);
  const floor=add(new T.PlaneGeometry(11,7.5),mat('#fff1cc',{map:carpet}),scene,0,.205,0);floor.rotation.x=-Math.PI/2;
  for(const z of [-3.78,3.78]){add(new T.BoxGeometry(11,.06,.05),gold,scene,0,.19,z);add(new T.BoxGeometry(11,.12,.03),gold,scene,0,.02,z);}
  // A festival canopy: separate woven panels sag between the support ropes.
  const fabricMap=patternedFabric();fabricMap.repeat.set(3,4);
  for(let strip=0;strip<12;strip++){
    const positions=[],uv=[],indices=[],color=[red,yellow,pink,gold][strip%4];
    for(let row=0;row<=16;row++)for(let col=0;col<=8;col++){
      const u=col/8,v=row/16,x=-9+strip*1.5+u*1.5,z=-8+v*17;
      positions.push(x,7.2-Math.sin(u*Math.PI)*.24-Math.sin(v*Math.PI)*.35,z);uv.push(u,v*3);
    }
    for(let row=0;row<16;row++)for(let col=0;col<8;col++){const a=row*9+col;indices.push(a,a+1,a+9,a+1,a+10,a+9);}
    const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(positions,3));geo.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geo.setIndex(indices);geo.computeVertexNormals();
    const cloth=color.clone();cloth.map=fabricMap;cloth.side=T.DoubleSide;add(geo,cloth,scene);
  }
  // Red fabric wraps around the posts; narrow gold seams catch the sunlight.
  for(const x of [-7.1,7.1])for(const z of [-5.8,5.8]){
    add(new T.CylinderGeometry(.09,.09,7.4,16),red,scene,x,3.45,z);
    const helix=[];for(let i=0;i<=120;i++){const a=i/120*Math.PI*24;helix.push(new T.Vector3(x+Math.cos(a)*.094,-.2+i/120*7.4,z+Math.sin(a)*.094));}
    add(new T.TubeGeometry(new T.CatmullRomCurve3(helix),120,.006,4,false),gold,scene);
  }
  // Pleated backdrop and scalloped swags, like an outdoor Braj raas gathering.
  for(let panel=0;panel<10;panel++){
    const pos=[],uv=[],index=[];
    for(let row=0;row<=10;row++)for(let col=0;col<=20;col++){const u=col/20,v=row/10;pos.push(-9+panel*1.8+u*1.8,1.7+v*4.2,-6.8+Math.sin(u*Math.PI*8)*.055);uv.push(u,v);}
    for(let row=0;row<10;row++)for(let col=0;col<20;col++){const a=row*21+col;index.push(a,a+1,a+21,a+1,a+22,a+21);}
    const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(pos,3));geo.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geo.setIndex(index);geo.computeVertexNormals();
    add(geo,mat(panel%2?'#ffe4a0':'#e6ab36',{side:T.DoubleSide,map:fabricMap}),scene);
    const curve=[];for(let i=0;i<=30;i++){const u=i/30;curve.push(new T.Vector3(-9+panel*1.8+u*1.8,5.8-Math.sin(u*Math.PI)*.7,-6.55));}
    add(new T.TubeGeometry(new T.CatmullRomCurve3(curve),30,.1,10,false),panel%2?gold:red,scene);
    for(let i=0;i<13;i++){const u=i/12;add(new T.SphereGeometry(.045,7,6),gold,scene,-9+panel*1.8+u*1.8,5.65-Math.sin(u*Math.PI)*.7,-6.5);}
  }
  for(const z of [-5.4,-2.4,.6,3.6]){
    const rope=[];for(let i=0;i<=40;i++){const x=-8+i*.4;rope.push(new T.Vector3(x,6.6-Math.sin(i/40*Math.PI)*.4,z));}
    add(new T.TubeGeometry(new T.CatmullRomCurve3(rope),40,.012,5,false),mat('#674826'),scene);
    for(let i=0;i<24;i++){
      const x=-7.6+i*.65,y=6.45-Math.sin((x+8)/16*Math.PI)*.4;
      const shape=new T.Shape();shape.moveTo(-.15,0);shape.lineTo(.15,0);shape.lineTo(0,-.28);shape.closePath();
      const flag=add(new T.ShapeGeometry(shape),mat(i%2?'#c82e4a':'#e8b541',{side:T.DoubleSide}),scene,x,y,z);flag.rotation.y=(i%3-1)*.3;
    }
  }
  // Simple audience chairs surround three sides, leaving the dance floor open.
  const seats=[];
  for(let i=0;i<7;i++)seats.push({x:-4.8+i*1.6,z:-4.75,yaw:0});
  for(const side of [-1,1])for(let i=0;i<4;i++)seats.push({x:side*6.3,z:-2.7+i*1.9,yaw:-side*Math.PI/2});
  const wood=mat('#734b2c');
  for(const seat of seats){const chair=new T.Group();scene.add(chair);chair.position.set(seat.x,0,seat.z);chair.rotation.y=seat.yaw;
    add(new T.BoxGeometry(.65,.12,.65),red,chair,0,.51,0);add(new T.BoxGeometry(.65,.64,.07),red,chair,0,.94,-.3);
    for(const x of [-.26,.26])for(const z of [-.26,.26])add(new T.CylinderGeometry(.025,.035,.5,8),wood,chair,x,.22,z);
  }
  const hanging=[];for(let i=0;i<11;i++){
    const x=-5+i,y=6.7-Math.sin(i/10*Math.PI)*.3;
    for(let j=0;j<11;j++)add(new T.SphereGeometry(.045,7,5),j%3?gold:red,scene,x,y-j*.07,-5.9);
  }
  // Light bulbs share one points draw call.
  const canvas=document.createElement('canvas');canvas.width=canvas.height=64;const context=canvas.getContext('2d'),g=context.createRadialGradient(32,32,0,32,32,32);g.addColorStop(0,'#fff7cf');g.addColorStop(.3,'#ffd87588');g.addColorStop(1,'#ffcc6600');context.fillStyle=g;context.fillRect(0,0,64,64);
  const positions=[];for(let i=0;i<26;i++)positions.push(-8+i*.64,6.1-Math.sin(i/25*Math.PI)*.4,-.8);
  const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(positions,3));const bulbs=new T.Points(geo,new T.PointsMaterial({map:new T.CanvasTexture(canvas),size:.35,transparent:true,depthWrite:false,blending:T.AdditiveBlending}));scene.add(bulbs);
  return {lights:[bulbs],seats};
}
