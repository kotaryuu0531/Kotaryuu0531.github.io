// 3Dバッジ → モーダルの自前ビューア（three.js）
// model-viewer を置き換え、メイキングページの自前ビューアと見た目を統一する。
// ・通常モデル（PBR）：RoomEnvironment ＋ 方向光（既定はソフト。data-dir/data-amb で調整可）
// ・大鯨（data-toon="1"）：making-taigei と同じトゥーンシェーダー（パラメータは確定既定値で固定・UIなし）
import * as THREE from "three";
import {GLTFLoader} from "three/addons/loaders/GLTFLoader.js";
import {OrbitControls} from "three/addons/controls/OrbitControls.js";
import {RoomEnvironment} from "three/addons/environments/RoomEnvironment.js";

// ============ 大鯨トゥーンの確定既定値（making-taigei.html と同一） ============
const TUNE={
  generic:{level:.80, tint:[1.00,.84,.72], rim:.22, lift:0},   // 名前不一致時の既定（暖色）
  skin:  {level:.88, tint:[1.00,.87,.83], rim:.18, lift:.15},
  face:  {level:.92, tint:[1.00,.88,.85], rim:.10, lift:.55},
  hair:  {level:.74, tint:[.82,.85,1.00], rim:.34, lift:0},
  cloth: {level:.78, tint:[.85,.87,1.00], rim:.22, lift:0},
  dark:  {level:.80, tint:[.88,.90,1.00], rim:.28, lift:0},
};
const RIM_COLOR=[.85,.92,1.0];
const SOFT=.035;
const SHADOW=.71;                     // 「影の強さ」既定値 71
const OUTLINE={screen:.0008, maxFrac:.0026, partCap:.18, minPart:.055};
const TRACE={hair:0x232c5e, skin:0xa5654f, cloth:0x3a4370, dark:0x2b2e40, shoes:0x6e4326}; // 色トレスON固定
const LIGHT_OFF={x:1.04, y:.48};      // ライトのカメラ基準オフセット（確定既定値）

const VERT=`
  #include <common>
  #include <skinning_pars_vertex>
  varying vec3 vN; varying vec3 vW; varying vec2 vUv;
  void main(){
    vUv=uv;
    #include <skinbase_vertex>
    #include <beginnormal_vertex>
    #include <skinnormal_vertex>
    #include <begin_vertex>
    #include <skinning_vertex>
    vec4 wp=modelMatrix*vec4(transformed,1.0);
    vW=wp.xyz;
    vN=normalize(mat3(modelMatrix)*objectNormal);
    gl_Position=projectionMatrix*viewMatrix*wp;
  }`;
const FRAG=`
  uniform sampler2D map; uniform float useMap; uniform vec3 baseColor;
  uniform vec3 uLightDir; uniform float uLevel; uniform vec3 uTint;
  uniform float uRim; uniform vec3 uRimColor; uniform float uLift;
  uniform float uThreshold; uniform float uSoft;
  varying vec3 vN; varying vec3 vW; varying vec2 vUv;
  void main(){
    vec4 base=mix(vec4(baseColor,1.0),texture2D(map,vUv),useMap);
    vec3 N=normalize(vN); if(!gl_FrontFacing) N=-N;
    vec3 V=normalize(cameraPosition-vW);
    float d=dot(N,normalize(uLightDir))*.5+.5;
    float shade=smoothstep(uThreshold-uSoft,uThreshold+uSoft,d);
    shade=mix(shade,1.0,uLift);
    vec3 shadowCol=base.rgb*uLevel*uTint;
    vec3 col=mix(shadowCol,base.rgb,shade);
    float fres=pow(1.0-clamp(dot(N,V),0.0,1.0),3.0);
    col+=uRimColor*(fres*uRim*(0.35+0.65*(1.0-shade)));
    gl_FragColor=vec4(col,base.a);
  }`;

let inited=false, renderer=null, scene=null, camera=null, controls=null, pmrem=null, envTex=null;
let stage=null, v3d=null, spinTxt=null;
let dirL=null, ambL=null;
let goalTarget=null, goalRadius=null;   // タップリセンターのグライド目標
let toonMats=[];               // 現在シーンのトゥーンマテリアル（ライト追従用）
const cache=new Map();         // glb URL → {group, toonMats, isToon, box}
let resumeT=null;

function ensureInit(){
  if(inited) return;
  inited=true;
  v3d=document.getElementById("v3d");
  spinTxt=v3d.querySelector(".v3d-spin .txt");
  stage=document.createElement("div");
  stage.className="v3d-stage";
  v3d.insertBefore(stage, v3d.querySelector(".v3d-hint"));

  renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  stage.appendChild(renderer.domElement);

  scene=new THREE.Scene();
  camera=new THREE.PerspectiveCamera(30,1,0.01,100);
  pmrem=new THREE.PMREMGenerator(renderer);
  envTex=pmrem.fromScene(new RoomEnvironment(),0.04).texture;

  dirL=new THREE.DirectionalLight(0xffffff,1); dirL.position.set(1.5,2.2,2.5); scene.add(dirL);
  ambL=new THREE.AmbientLight(0xffffff,1); scene.add(ambL);

  controls=new OrbitControls(camera,renderer.domElement);
  controls.enableDamping=true; controls.dampingFactor=.08;
  controls.autoRotate=true; controls.autoRotateSpeed=1.1;
  controls.addEventListener("start",()=>{controls.autoRotate=false; if(resumeT)clearTimeout(resumeT);});
  controls.addEventListener("end",()=>{if(resumeT)clearTimeout(resumeT); resumeT=setTimeout(()=>{controls.autoRotate=true;},3000);});

  window.addEventListener("resize",resize);

  // タップリセンター（model-viewer SmoothControls.recenter の移植）
  // タップ（300ms以内・移動2px以内）でモデル表面をレイキャストし、ヒット点を回転の中心に。空振りは初期フレーミングへ。
  const TAP_MS=300, TAP_DIST=2;
  const raycaster=new THREE.Raycaster();
  let tapStart=null;
  renderer.domElement.addEventListener("pointerdown",e=>{
    tapStart={x:e.clientX,y:e.clientY,t:performance.now()};
  });
  renderer.domElement.addEventListener("pointerup",e=>{
    const st=tapStart; tapStart=null;
    if(!st||!current)return;
    if(performance.now()>st.t+TAP_MS||Math.abs(e.clientX-st.x)>TAP_DIST||Math.abs(e.clientY-st.y)>TAP_DIST)return;
    const rect=renderer.domElement.getBoundingClientRect();
    const ndc=new THREE.Vector2(((e.clientX-rect.left)/rect.width)*2-1, -((e.clientY-rect.top)/rect.height)*2+1);
    raycaster.setFromCamera(ndc,camera);
    current.group.traverse(o=>{ if(o.isSkinnedMesh&&!o.userData.isOutline&&o.computeBoundingSphere)o.computeBoundingSphere(); });
    const hit=raycaster.intersectObject(current.group,true)
      .find(h=>(h.object.isMesh||h.object.isSkinnedMesh)&&!h.object.userData.isOutline);
    if(hit){ goalTarget=hit.point.clone(); goalRadius=null; }
    else if(current.homeCenter){ goalTarget=current.homeCenter.clone(); goalRadius=current.homeDist; }
  });

  const L=new THREE.Vector3(), R=new THREE.Vector3(), D=new THREE.Vector3(); const clock=new THREE.Clock();
  renderer.setAnimationLoop(()=>{
    const dt=clock.getDelta();
    if(!v3d.classList.contains("open")) return;   // 閉じている間は描画しない
    // タップリセンターのグライド：ターゲットとカメラを同じ差分で動かす（向き・距離を保持）
    if(goalTarget&&current){
      const k=1-Math.exp(-dt*20);   // model-viewerのDamper（減衰50ms）相当
      D.copy(goalTarget).sub(controls.target).multiplyScalar(k);
      controls.target.add(D); camera.position.add(D);
      const md=current.maxDim||1;
      if(controls.target.distanceToSquared(goalTarget)<md*md*1e-8) goalTarget=null;
    }
    if(goalRadius!=null&&current){
      const cur=camera.position.distanceTo(controls.target);
      const nr=cur+(goalRadius-cur)*(1-Math.exp(-dt*20));
      camera.position.sub(controls.target).setLength(nr).add(controls.target);
      if(Math.abs(nr-goalRadius)<(current.maxDim||1)*1e-4) goalRadius=null;
    }
    controls.update();
    if(current&&current.mixer) current.mixer.update(dt);
    if(toonMats.length){  // トゥーン：ライトはカメラに追従（正面やや右上）
      L.copy(camera.position).sub(controls.target).normalize();
      R.setFromMatrixColumn(camera.matrixWorld,0);
      L.addScaledVector(R,LIGHT_OFF.x).addScaledVector(new THREE.Vector3(0,1,0),LIGHT_OFF.y).normalize();
      for(const m of toonMats) m.uniforms.uLightDir.value.copy(L);
    }
    renderer.render(scene,camera);
  });
}
function resize(){
  if(!stage) return;
  const w=stage.clientWidth,h=stage.clientHeight;
  if(!w||!h) return;
  renderer.setSize(w,h,false); camera.aspect=w/h; camera.updateProjectionMatrix();
}

// ============ 大鯨トゥーン変換（making-taigei と同じロジック・UI値は固定） ============
const white1x1=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1); white1x1.needsUpdate=true;
function makeToon(albedoTex, solidColor, prm, list){
  let tex=null;
  if(albedoTex){ tex=albedoTex.clone(); tex.colorSpace=THREE.NoColorSpace; tex.needsUpdate=true; }
  const th=0.30+0.34*SHADOW, sc=Math.min(SHADOW*1.7,1.9);
  const level=Math.max(.35, 1-(1-prm.level)*sc);
  const mat=new THREE.ShaderMaterial({
    vertexShader:VERT, fragmentShader:FRAG, side:THREE.DoubleSide,
    uniforms:{
      map:{value:tex||white1x1}, useMap:{value:tex?1:0},
      baseColor:{value:new THREE.Color().fromArray(solidColor||[1,1,1])},
      uLightDir:{value:new THREE.Vector3(0,1,1)},
      uLevel:{value:level}, uTint:{value:new THREE.Color().fromArray(prm.tint)},
      uRim:{value:prm.rim}, uRimColor:{value:new THREE.Color().fromArray(RIM_COLOR)},
      uLift:{value:prm.lift}, uThreshold:{value:th}, uSoft:{value:SOFT},
    }});
  list.push(mat); return mat;
}
function paramsFor(name){
  if(name==="Face")return TUNE.face;
  if(name==="Body")return TUNE.skin;
  if(name==="tex_hair")return TUNE.hair;
  if(name==="tex_body")return TUNE.dark;
  if(name==="制服"||name==="tex_uniform.001")return TUNE.cloth;
  return TUNE.generic;
}
function traceColorFor(name){
  if(name==="tex_hair")return TRACE.hair;
  if(name==="Face"||name==="Body")return TRACE.skin;
  if(name==="tex_body")return TRACE.dark;
  if(name==="shoes")return TRACE.shoes;
  if(name==="tex_uniform.001"||name==="制服")return TRACE.cloth;
  return 0x9a4f22;   // 汎用は暗いオレンジ茶
}
function outlineMat(cap, traceHex){
  return new THREE.ShaderMaterial({
    side:THREE.BackSide,
    uniforms:{oScreen:{value:OUTLINE.screen},oMax:{value:cap},oColor:{value:new THREE.Color(traceHex)}},
    vertexShader:`
      #include <common>
      #include <skinning_pars_vertex>
      uniform float oScreen; uniform float oMax;
      void main(){
        float mask=1.0;
        #ifdef USE_COLOR
          mask=color.r;
        #endif
        #include <skinbase_vertex>
        #include <beginnormal_vertex>
        #include <skinnormal_vertex>
        #include <begin_vertex>
        #include <skinning_vertex>
        vec4 mv=modelViewMatrix*vec4(transformed,1.0);
        float w=min(oScreen*max(-mv.z,0.0),oMax)*mask;
        vec3 p=transformed+normalize(objectNormal)*w;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);
      }`,
    fragmentShader:`
      uniform vec3 oColor;
      void main(){ gl_FragColor=vec4(oColor,1.0); }`
  });
}
function toonify(model, box, list){
  const maxDim=Math.max(...box.getSize(new THREE.Vector3()).toArray());
  const normName=(n)=>String(n||"").replace(/[^0-9A-Za-z_ぁ-んァ-ヶ一-龠]/g,"");
  const NO_OUTLINE=["tongue","body001"];
  const isExcluded=(o)=>{
    for(let cur=o;cur;cur=cur.parent){ if(NO_OUTLINE.includes(normName(cur.name)))return true; }
    return false;
  };
  model.updateMatrixWorld(true);
  const tmpS=new THREE.Vector3(), outlines=[];
  model.traverse((o)=>{
    if(!o.isMesh)return;
    const src=o.material, matName=(src&&src.name)||"";
    if(matName==="highlight"){ o.material=new THREE.MeshBasicMaterial({color:0xffffff,side:THREE.DoubleSide}); return; }
    if(o.isSkinnedMesh) o.frustumCulled=false;
    const albedo=src.emissiveMap||src.map||null;
    let solid=null;
    if(!albedo){
      const em=src.emissive&&(src.emissive.r+src.emissive.g+src.emissive.b)>0.001;
      const c=em?src.emissive:src.color; solid=[c.r,c.g,c.b];
    }
    o.material=makeToon(albedo, solid, paramsFor(matName), list);
    if(matName===""||isExcluded(o))return;
    if(!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    o.getWorldScale(tmpS);
    const r=o.geometry.boundingSphere.radius*Math.max(tmpS.x,tmpS.y,tmpS.z);
    if(r<maxDim*OUTLINE.minPart && matName!=="tex_hair")return;
    const cap=Math.min(maxDim*OUTLINE.maxFrac, r*OUTLINE.partCap);
    const om=outlineMat(cap, traceColorFor(matName));
    if(o.geometry.attributes.color) om.vertexColors=true;
    let ol;
    if(o.isSkinnedMesh){ ol=new THREE.SkinnedMesh(o.geometry,om); ol.bind(o.skeleton,o.bindMatrix); ol.frustumCulled=false; }
    else ol=new THREE.Mesh(o.geometry,om);
    ol.renderOrder=-1; ol.userData.isOutline=true;
    outlines.push([o,ol]);
  });
  outlines.forEach(([o,ol])=>o.add(ol));
}

// ============ シーンの入れ替え・フレーミング ============
let current=null;
function mountEntry(entry, opts){
  if(current&&current.group.parent) scene.remove(current.group);
  current=entry;
  scene.add(entry.group);
  toonMats=entry.toonMats;

  if(entry.isToon){
    scene.environment=null;
    renderer.toneMapping=THREE.NoToneMapping;
    dirL.visible=false; ambL.visible=false;
  }else{
    scene.environment=envTex;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure=1.05;
    // 既定はソフト（メイキングの自前ビューアと同係数）。RX-7等は data-contrast="strong"
    const strong=(opts.contrast==="strong");
    dirL.visible=true; ambL.visible=true;
    dirL.intensity=Math.PI*.4*(strong?1.0:0.55);
    ambL.intensity=Math.PI*.4*(strong?0.375:0.75);
  }

  // フレーミング（data-angle / data-elev / data-zoom があれば優先）
  const box=entry.box;
  const size=box.getSize(new THREE.Vector3()), center=box.getCenter(new THREE.Vector3());
  const maxDim=Math.max(size.x,size.y,size.z);
  camera.fov=entry.isToon?28:30;
  controls.target.copy(center);
  const zoom=(opts.zoom!=null&&!isNaN(parseFloat(opts.zoom)))?parseFloat(opts.zoom):(entry.isToon?1.25:1.3);
  const angDeg=(opts.angle!=null&&!isNaN(parseFloat(opts.angle)))?parseFloat(opts.angle):(entry.isToon?20:-28);
  const elev=(opts.elev!=null&&!isNaN(parseFloat(opts.elev)))?parseFloat(opts.elev):(entry.isToon?0.10:0.28);
  const dist=(maxDim/2)/Math.tan((camera.fov*Math.PI/180)/2)*zoom;
  const a=angDeg*Math.PI/180;
  camera.position.set(center.x+dist*Math.sin(a),
                      center.y+dist*elev,
                      center.z+dist*Math.cos(a));
  camera.near=maxDim/100; camera.far=maxDim*20; camera.updateProjectionMatrix();
  controls.update();
  controls.autoRotate=true;
  entry.homeCenter=center.clone(); entry.homeDist=camera.position.distanceTo(center); entry.maxDim=maxDim;
  goalTarget=null; goalRadius=null;
  resize();
}

export function open(opts){
  ensureInit();
  v3d.classList.add("open","loading"); v3d.setAttribute("aria-hidden","false"); document.body.style.overflow="hidden";
  if(spinTxt) spinTxt.textContent="読み込み中…";
  requestAnimationFrame(resize);

  const key=opts.glb;
  if(cache.has(key)){
    mountEntry(cache.get(key), opts);
    v3d.classList.remove("loading");
    return;
  }
  const loader=new GLTFLoader();
  loader.load(opts.glb,(gltf)=>{
    const group=gltf.scene;
    const list=[];
    let box=new THREE.Box3().setFromObject(group);
    if(opts.toon) toonify(group, box, list);
    else if(opts.env!=null&&!isNaN(parseFloat(opts.env))){
      const ei=parseFloat(opts.env);
      group.traverse(o=>{ if(o.isMesh&&o.material&&o.material.envMapIntensity!=null)o.material.envMapIntensity=ei; });
    }
    let mixer=null;
    if(gltf.animations&&gltf.animations.length){
      mixer=new THREE.AnimationMixer(group);
      mixer.clipAction(gltf.animations[0]).play();
      // スキン変形後の実ポーズをサンプリングして動き全体を収める
      const sampled=new THREE.Box3(), tmp=new THREE.Box3();
      const dur=gltf.animations[0].duration;
      for(const t of [0,.25,.5,.75,.999]){
        mixer.setTime(t*dur); group.updateMatrixWorld(true);
        group.traverse(o=>{
          if(o.userData.isOutline)return;
          if(o.isSkinnedMesh){ o.computeBoundingBox(); tmp.copy(o.boundingBox).applyMatrix4(o.matrixWorld); sampled.union(tmp); }
          else if(o.isMesh){ if(!o.geometry.boundingBox)o.geometry.computeBoundingBox(); tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld); sampled.union(tmp); }
        });
      }
      mixer.setTime(0);
      box=sampled;
    }
    const entry={group, toonMats:list, isToon:!!opts.toon, box, mixer};
    cache.set(key, entry);
    mountEntry(entry, opts);
    v3d.classList.remove("loading");
  },(e)=>{
    if(e&&e.total&&spinTxt){ spinTxt.textContent="読み込み中 "+Math.round(100*e.loaded/e.total)+"%"; }
  },(err)=>{
    if(spinTxt) spinTxt.textContent="読み込みに失敗しました";  // loadingは維持してメッセージを見せる
    console.error(err);
  });
}
