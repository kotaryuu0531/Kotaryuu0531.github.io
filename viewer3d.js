// 汎用3Dビューア（自作・three.js）
// 使い方：<div id="gviewer" data-glb="model.glb" data-poster="poster.jpg" data-angle="-28" data-fov="30" data-exposure="1.05">
// モード：ノーマル（元マテリアル＋環境光）／ワイヤー（クレイ＋対角線を除去した四角面ワイヤー）
import * as THREE from "three";
import {GLTFLoader} from "three/addons/loaders/GLTFLoader.js";
import {OrbitControls} from "three/addons/controls/OrbitControls.js";
import {RoomEnvironment} from "three/addons/environments/RoomEnvironment.js";

const holder=document.getElementById("gviewer");
const spin=document.getElementById("gv-spin"), spinTxt=document.getElementById("gv-spin-txt");
const GLB=holder.dataset.glb;
const ANGLE=parseFloat(holder.dataset.angle||"-28");
const FOV=parseFloat(holder.dataset.fov||"30");
const EXPOSURE=parseFloat(holder.dataset.exposure||"1.0");
if(holder.dataset.poster){
  holder.style.backgroundImage="url('"+holder.dataset.poster+"')";
  holder.style.backgroundSize="cover"; holder.style.backgroundPosition="center";
}

const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=EXPOSURE;
holder.appendChild(renderer.domElement);

const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(FOV,1,0.01,100);

// PBR用の環境光（model-viewerのneutral相当）＋クレイ用の方向光
const pmrem=new THREE.PMREMGenerator(renderer);
scene.environment=pmrem.fromScene(new RoomEnvironment(),0.04).texture;
const dir=new THREE.DirectionalLight(0xffffff,Math.PI*.4); dir.position.set(1.5,2.2,2.5); scene.add(dir);
scene.add(new THREE.AmbientLight(0xffffff,Math.PI*.15));

const controls=new OrbitControls(camera,renderer.domElement);
controls.enableDamping=true; controls.dampingFactor=.08;
controls.autoRotate=true; controls.autoRotateSpeed=1.1;
let resumeT=null;
controls.addEventListener("start",()=>{controls.autoRotate=false; if(resumeT)clearTimeout(resumeT);});
controls.addEventListener("end",()=>{if(resumeT)clearTimeout(resumeT); resumeT=setTimeout(()=>{controls.autoRotate=true;},3000);});

function resize(){
  const w=holder.clientWidth,h=holder.clientHeight;
  renderer.setSize(w,h,false); camera.aspect=w/h; camera.updateProjectionMatrix();
}
window.addEventListener("resize",resize);

// ===== ワイヤーモード（クレイ＋四角面ワイヤー） =====
const clayMat=new THREE.MeshStandardMaterial({color:0xb6bcc6,roughness:.95,metalness:0,side:THREE.DoubleSide,
  polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1});
const lineMat=new THREE.LineBasicMaterial({color:0x14161c});
const wires=[]; let wiresBuilt=false; let modelRef=null;

// 三角形化で入った対角線を除去したワイヤー（両側の三角形どちらでも最長辺＝対角線とみなす）
function buildQuadWire(geo){
  const pos=geo.attributes.position, idx=geo.index?geo.index.array:null;
  const triCount=idx?idx.length/3:pos.count/3;
  const P=new THREE.Vector3(), Q=new THREE.Vector3(), Rv=new THREE.Vector3();
  const pk=(i)=>{P.fromBufferAttribute(pos,i);return Math.round(P.x*1e4)+","+Math.round(P.y*1e4)+","+Math.round(P.z*1e4);};
  const map=new Map();
  const gi=(t,k)=>idx?idx[t*3+k]:t*3+k;
  for(let t=0;t<triCount;t++){
    const a=gi(t,0),b=gi(t,1),c=gi(t,2);
    P.fromBufferAttribute(pos,a);Q.fromBufferAttribute(pos,b);Rv.fromBufferAttribute(pos,c);
    const lab=P.distanceToSquared(Q),lbc=Q.distanceToSquared(Rv),lca=Rv.distanceToSquared(P);
    let longest=0; if(lbc>=lab&&lbc>=lca)longest=1; else if(lca>=lab&&lca>=lbc)longest=2;
    const ka=pk(a),kb=pk(b),kc=pk(c);
    const edges=[[ka,kb,a,b],[kb,kc,b,c],[kc,ka,c,a]];
    for(let e=0;e<3;e++){
      const [k1,k2,i1,i2]=edges[e];
      const key=k1<k2?k1+"|"+k2:k2+"|"+k1;
      let rec=map.get(key); if(!rec){rec={n:0,long:0,i1,i2};map.set(key,rec);}
      rec.n++; if(e===longest)rec.long++;
    }
  }
  const verts=[];
  for(const rec of map.values()){
    if(rec.n>=2&&rec.long>=2)continue;
    P.fromBufferAttribute(pos,rec.i1);Q.fromBufferAttribute(pos,rec.i2);
    verts.push(P.x,P.y,P.z,Q.x,Q.y,Q.z);
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute("position",new THREE.Float32BufferAttribute(verts,3));
  return g;
}
function buildWires(){
  if(wiresBuilt||!modelRef)return; wiresBuilt=true;
  modelRef.traverse(o=>{
    if(!o.isMesh||!o.userData.matOrig)return;
    const l=new THREE.LineSegments(buildQuadWire(o.geometry),lineMat);
    l.renderOrder=2; l.visible=false;
    o.add(l); wires.push(l);
  });
}

// ===== 読み込み =====
const loader=new GLTFLoader();
loader.load(GLB,(gltf)=>{
  const model=gltf.scene; modelRef=model;
  model.traverse(o=>{ if(o.isMesh){ o.userData.matOrig=o.material; } });
  scene.add(model);

  const box=new THREE.Box3().setFromObject(model);
  const size=box.getSize(new THREE.Vector3()), center=box.getCenter(new THREE.Vector3());
  const maxDim=Math.max(size.x,size.y,size.z);
  controls.target.copy(center);
  const dist=(maxDim/2)/Math.tan((camera.fov*Math.PI/180)/2)*1.3;
  const a=ANGLE*Math.PI/180;
  camera.position.set(center.x+dist*Math.sin(a), center.y+dist*0.28, center.z+dist*Math.cos(a));
  camera.near=maxDim/100; camera.far=maxDim*20; camera.updateProjectionMatrix();
  controls.update();

  applyMode();
  holder.style.backgroundImage="";
  spin.classList.add("off");
},(e)=>{
  if(e&&e.total){ spinTxt.textContent="読み込み中 "+Math.round(100*e.loaded/e.total)+"%"; }
},(err)=>{
  spinTxt.textContent="読み込みに失敗しました"; console.error(err);
});

// ===== モードUI =====
const modeBtns=[...document.querySelectorAll("#gv-mode button")];
let mode="normal";
function applyMode(){
  if(modelRef){
    if(mode==="wire") buildWires();
    modelRef.traverse(o=>{ if(o.isMesh&&o.userData.matOrig){
      o.material=(mode==="wire")?clayMat:o.userData.matOrig;
    }});
    wires.forEach(w=>w.visible=(mode==="wire"));
  }
  modeBtns.forEach(b=>b.classList.toggle("on",b.dataset.mode===mode));
}
modeBtns.forEach(b=>b.addEventListener("click",()=>{mode=b.dataset.mode; applyMode();}));

resize();
renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera);});
