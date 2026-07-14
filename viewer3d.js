// 汎用3Dビューア（自作・three.js）— 複数インスタンス対応版
// 使い方：<div id="gviewer" data-glb="model.glb" ...> または <div class="gv3d" data-glb="...">
//   data-angle / data-elev / data-zoom … カメラ初期位置（zoom省略時は1.3）
//   data-exposure / data-dir / data-amb / data-env … ライティング
//   data-toon="1" … 暖色トゥーン（スキニング対応・色トレス輪郭）
// UI（ビューアと同じ .viewer 内に置く・すべて任意）：
//   #gv-mode / .gv-mode … ノーマル／ワイヤー切替ボタン（data-mode="normal|wire"）
//   .gv-clip            … アニメクリップ切替ボタンの生成先（クリップが2つ以上のとき）
//   .gv-rot             … オートターンON/OFFトグルボタン
// モード：ノーマル（元マテリアル＋環境光）／ワイヤー（クレイ＋対角線を除去した四角面ワイヤー。
//         アニメ付きは先頭フレーム(0秒)の実ポーズで静止・シェイプキー対応）
// GLBの読み込みはビューアが画面に近づいてから開始（遅延ロード）。
import * as THREE from "three";
import {GLTFLoader} from "three/addons/loaders/GLTFLoader.js";
import {OrbitControls} from "three/addons/controls/OrbitControls.js";
import {RoomEnvironment} from "three/addons/environments/RoomEnvironment.js";

// ===== 汎用トゥーン定数（単一パラメータ・スキニング対応） =====
const TOON_PRM={level:.8, tint:[1.0,.84,.72], rim:.22, lift:0};   // 暖色シャドウ
const TOON_RIM=[1.0,.94,.8];
const TOON_TRACE=0x9a4f22;   // 色トレス（暗いオレンジ茶）
const TOON_SHADOW=.71, TOON_SOFT=.035;
const TOON_OUT={screen:.0008, maxFrac:.0026, partCap:.18};
const TOON_LIGHT={x:1.04, y:.48};
const TOON_VERT=`
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
const TOON_FRAG=`
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
const white1x1=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1); white1x1.needsUpdate=true;

// ===== 1ビューア分の初期化 =====
function initViewer(holder){
  const GLB=holder.dataset.glb;
  if(!GLB) return;
  const ANGLE=parseFloat(holder.dataset.angle||"-28");
  const FOV=parseFloat(holder.dataset.fov||"30");
  const EXPOSURE=parseFloat(holder.dataset.exposure||"1.0");
  // コントラスト調整：方向光（陰影の強さ）と環境光（持ち上げ）の係数。既定はソフト。
  const DIRF=parseFloat(holder.dataset.dir||"0.55");
  const AMBF=parseFloat(holder.dataset.amb||"0.75");
  const ENVI=parseFloat(holder.dataset.env||"1.0");
  const TOON=holder.dataset.toon==="1";
  const ELEV=parseFloat(holder.dataset.elev||"0.28");
  const ZOOM=parseFloat(holder.dataset.zoom||"1.3");
  const WIREPOSE=holder.dataset.wirepose||"first";   // "first"=先頭フレーム / "bind"=バインド（T）ポーズ

  // UIはビューアと同じ .viewer（無ければ親要素）内で探す
  const root=holder.closest(".viewer")||holder.parentElement||document;
  const spin=holder.querySelector(".spin");
  const spinTxt=holder.querySelector(".spin-txt");
  const modeBox=root.querySelector("#gv-mode, .gv-mode");
  const clipBox=root.querySelector(".gv-clip");
  let rotBtn=root.querySelector(".gv-rot");
  if(!rotBtn){   // ページ側に無ければ自動生成してビューア右下に重ねる
    rotBtn=document.createElement("button");
    rotBtn.type="button"; rotBtn.className="gv-rot on";
    rotBtn.textContent="オートターン: ON";
    rotBtn.style.cssText="position:absolute;right:12px;bottom:12px;z-index:5;font-family:'Space Mono',monospace;font-size:11px;letter-spacing:.06em;padding:8px 14px;border-radius:100px;background:rgba(10,13,18,.7);border:1px solid #262A30;color:#8C887F;cursor:pointer;transition:all .25s";
    rotBtn.addEventListener("mouseenter",()=>{rotBtn.style.borderColor="#E9A94C";rotBtn.style.color="#E9A94C";});
    rotBtn.addEventListener("mouseleave",()=>{const on=rotBtn.classList.contains("on");rotBtn.style.borderColor=on?"#E9A94C":"#262A30";rotBtn.style.color=on?"#E9A94C":"#8C887F";});
    if(getComputedStyle(holder).position==="static")holder.style.position="relative";
    holder.appendChild(rotBtn);
  }
  const syncRotBtn=()=>{const on=rotBtn.classList.contains("on");rotBtn.style.borderColor=on?"#E9A94C":"#262A30";rotBtn.style.color=on?"#E9A94C":"#8C887F";};
  syncRotBtn();

  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=TOON?THREE.NoToneMapping:THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=EXPOSURE;
  holder.appendChild(renderer.domElement);

  const scene=new THREE.Scene();
  const camera=new THREE.PerspectiveCamera(FOV,1,0.01,100);

  // PBR用の環境光（model-viewerのneutral相当）＋方向光
  const pmrem=new THREE.PMREMGenerator(renderer);
  scene.environment=pmrem.fromScene(new RoomEnvironment(),0.04).texture;
  const dir=new THREE.DirectionalLight(0xffffff,Math.PI*.4*DIRF); dir.position.set(1.5,2.2,2.5); scene.add(dir);
  scene.add(new THREE.AmbientLight(0xffffff,Math.PI*.4*AMBF));

  const controls=new OrbitControls(camera,renderer.domElement);
  controls.enableDamping=true; controls.dampingFactor=.08;
  controls.autoRotate=true; controls.autoRotateSpeed=1.1;
  let rotateWanted=true;   // 手動トグルの状態（OFFなら放置しても再開しない）
  let resumeT=null;
  controls.addEventListener("start",()=>{controls.autoRotate=false; if(resumeT)clearTimeout(resumeT);});
  controls.addEventListener("end",()=>{if(resumeT)clearTimeout(resumeT); resumeT=setTimeout(()=>{ if(rotateWanted)controls.autoRotate=true; },3000);});
  if(rotBtn){
    rotBtn.addEventListener("click",()=>{
      rotateWanted=!rotateWanted;
      controls.autoRotate=rotateWanted;
      if(!rotateWanted&&resumeT)clearTimeout(resumeT);
      rotBtn.classList.toggle("on",rotateWanted);
      rotBtn.textContent="オートターン: "+(rotateWanted?"ON":"OFF");
      syncRotBtn();
    });
  }

  function resize(){
    const w=holder.clientWidth,h=holder.clientHeight;
    if(!w||!h)return;
    renderer.setSize(w,h,false); camera.aspect=w/h; camera.updateProjectionMatrix();
  }
  window.addEventListener("resize",resize);

  // ---- トゥーン変換 ----
  const toonMats=[]; const outlines=[];
  function toonifyModel(model){
    const box=new THREE.Box3().setFromObject(model);
    const maxDim=Math.max(...box.getSize(new THREE.Vector3()).toArray());
    const th=0.30+0.34*TOON_SHADOW, sc=Math.min(TOON_SHADOW*1.7,1.9);
    const level=Math.max(.35, 1-(1-TOON_PRM.level)*sc);
    const tmpS=new THREE.Vector3(); const pend=[];
    model.updateMatrixWorld(true);
    model.traverse(o=>{
      if(!o.isMesh||o.userData.isOutline)return;
      const src=o.material;
      let tex=null, solid=null;
      const albedo=(src&&(src.emissiveMap||src.map))||null;
      if(albedo){ tex=albedo.clone(); tex.colorSpace=THREE.NoColorSpace; tex.needsUpdate=true; }
      else{ const c=(src&&src.color)||new THREE.Color(1,1,1); solid=[c.r,c.g,c.b]; }
      o.material=new THREE.ShaderMaterial({
        vertexShader:TOON_VERT, fragmentShader:TOON_FRAG, side:THREE.DoubleSide,
        uniforms:{
          map:{value:tex||white1x1}, useMap:{value:tex?1:0},
          baseColor:{value:new THREE.Color().fromArray(solid||[1,1,1])},
          uLightDir:{value:new THREE.Vector3(0,1,1)},
          uLevel:{value:level}, uTint:{value:new THREE.Color().fromArray(TOON_PRM.tint)},
          uRim:{value:TOON_PRM.rim}, uRimColor:{value:new THREE.Color().fromArray(TOON_RIM)},
          uLift:{value:TOON_PRM.lift}, uThreshold:{value:th}, uSoft:{value:TOON_SOFT},
        }});
      toonMats.push(o.material);
      if(o.isSkinnedMesh) o.frustumCulled=false;
      // 輪郭（バックフェイスハル・スキニング対応）
      if(!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      o.getWorldScale(tmpS);
      const r=o.geometry.boundingSphere.radius*Math.max(tmpS.x,tmpS.y,tmpS.z);
      const cap=Math.min(maxDim*TOON_OUT.maxFrac, r*TOON_OUT.partCap);
      const om=new THREE.ShaderMaterial({
        side:THREE.BackSide,
        uniforms:{oScreen:{value:TOON_OUT.screen},oMax:{value:cap},oColor:{value:new THREE.Color(TOON_TRACE)}},
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
        fragmentShader:`uniform vec3 oColor; void main(){ gl_FragColor=vec4(oColor,1.0); }`
      });
      if(o.geometry.attributes.color) om.vertexColors=true;
      let ol;
      if(o.isSkinnedMesh){ ol=new THREE.SkinnedMesh(o.geometry,om); ol.bind(o.skeleton,o.bindMatrix); ol.frustumCulled=false; }
      else ol=new THREE.Mesh(o.geometry,om);
      ol.renderOrder=-1; ol.userData.isOutline=true;
      pend.push([o,ol]); outlines.push(ol);
    });
    pend.forEach(([o,ol])=>o.add(ol));
  }

  // ---- ワイヤーモード（クレイ＋四角面ワイヤー・先頭フレーム固定・シェイプキー対応） ----
  const clayMat=new THREE.MeshStandardMaterial({color:0xb6bcc6,roughness:.95,metalness:0,side:THREE.DoubleSide,
    polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1});
  const lineMat=new THREE.LineBasicMaterial({color:0x14161c});
  let wires=[]; let wiresKey=null; let modelRef=null;

  // 三角形化で入った対角線を除去したワイヤー（両側の三角形どちらでも最長辺＝対角線とみなす）
  function buildQuadWire(geo,dpos){
    const idx=geo.index?geo.index.array:null;
    const count=dpos.length/3;
    const triCount=idx?idx.length/3:count/3;
    const P=new THREE.Vector3(), Q=new THREE.Vector3(), Rv=new THREE.Vector3();
    const gp=(i,t)=>t.set(dpos[i*3],dpos[i*3+1],dpos[i*3+2]);
    const pk=(i)=>{gp(i,P);return Math.round(P.x*1e4)+","+Math.round(P.y*1e4)+","+Math.round(P.z*1e4);};
    const map=new Map();
    const gi=(t,k)=>idx?idx[t*3+k]:t*3+k;
    for(let t=0;t<triCount;t++){
      const a=gi(t,0),b=gi(t,1),c=gi(t,2);
      gp(a,P);gp(b,Q);gp(c,Rv);
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
      gp(rec.i1,P);gp(rec.i2,Q);
      verts.push(P.x,P.y,P.z,Q.x,Q.y,Q.z);
    }
    const g=new THREE.BufferGeometry();
    g.setAttribute("position",new THREE.Float32BufferAttribute(verts,3));
    return g;
  }
  // スキン変形＋シェイプキー適用後（現在の姿勢）の頂点位置。ワイヤーをメッシュにピッタリ合わせる用。
  function deformedPositions(mesh){
    const geo=mesh.geometry, pos=geo.attributes.position, n=pos.count;
    const out=new Float32Array(n*3), v=new THREE.Vector3(), t=new THREE.Vector3();
    const morphPos=geo.morphAttributes && geo.morphAttributes.position;
    const infl=mesh.morphTargetInfluences;
    const skinned=mesh.isSkinnedMesh;
    const bt=skinned ? (mesh.applyBoneTransform?mesh.applyBoneTransform.bind(mesh):mesh.boneTransform.bind(mesh)) : null;
    for(let i=0;i<n;i++){
      v.fromBufferAttribute(pos,i);
      // glTFのモーフは相対値なので base + Σ w*delta
      if(morphPos&&infl){
        for(let m=0;m<morphPos.length;m++){
          const w=infl[m]; if(!w)continue;
          t.fromBufferAttribute(morphPos[m],i); v.addScaledVector(t,w);
        }
      }
      if(bt) bt(i,v);   // スキン変形（ボーン）
      out[i*3]=v.x; out[i*3+1]=v.y; out[i*3+2]=v.z;
    }
    return out;
  }
  function disposeWires(){ wires.forEach(w=>{ if(w.parent)w.parent.remove(w); if(w.geometry)w.geometry.dispose(); }); wires=[]; wiresKey=null; }
  function buildWires(key){
    if(!modelRef)return;
    if(wiresKey===key){ return; }
    disposeWires();
    modelRef.updateMatrixWorld(true);
    modelRef.traverse(o=>{
      if(!o.isMesh||!o.userData.matOrig||o.userData.isOutline)return;
      const l=new THREE.LineSegments(buildQuadWire(o.geometry,deformedPositions(o)),lineMat);
      l.renderOrder=2; l.visible=false;
      o.add(l); wires.push(l);
    });
    wiresKey=key;
  }

  // ---- タップリセンター（model-viewer SmoothControls.recenter の移植） ----
  // タップ（300ms以内・移動2px以内）でモデル表面をレイキャストし、ヒット点を回転の中心に。
  // カメラは角度・距離を保ったまま追従（＝タップ点が画面中心へグライド）。空振りは初期フレーミングへ戻す。
  const TAP_MS=300, TAP_DIST=2;
  const raycaster=new THREE.Raycaster();
  let tapStart=null, goalTarget=null, goalRadius=null;
  let homeCenter=null, homeDist=0, sceneMaxDim=1;
  renderer.domElement.addEventListener("pointerdown",e=>{
    tapStart={x:e.clientX,y:e.clientY,t:performance.now()};
  });
  renderer.domElement.addEventListener("pointerup",e=>{
    const st=tapStart; tapStart=null;
    if(!st||!modelRef||!homeCenter)return;
    if(performance.now()>st.t+TAP_MS||Math.abs(e.clientX-st.x)>TAP_DIST||Math.abs(e.clientY-st.y)>TAP_DIST)return;
    const rect=renderer.domElement.getBoundingClientRect();
    const ndc=new THREE.Vector2(((e.clientX-rect.left)/rect.width)*2-1, -((e.clientY-rect.top)/rect.height)*2+1);
    raycaster.setFromCamera(ndc,camera);
    // アニメ中のスキンメッシュはバウンディングが古くなるため再計算してからレイキャスト
    modelRef.traverse(o=>{ if(o.isSkinnedMesh&&!o.userData.isOutline&&o.computeBoundingSphere)o.computeBoundingSphere(); });
    const hit=raycaster.intersectObject(modelRef,true)
      .find(h=>(h.object.isMesh||h.object.isSkinnedMesh)&&!h.object.userData.isOutline);
    if(hit){ goalTarget=hit.point.clone(); goalRadius=null; }
    else{ goalTarget=homeCenter.clone(); goalRadius=homeDist; }   // 空振り＝初期フレーミングへ
  });

  // ---- 読み込み ----
  let mixer=null, actions={}, active=null, activeName=""; const clock=new THREE.Clock();
  let mode="normal";
  const loader=new GLTFLoader();
  // スキン変形後の実頂点からバウンディングを計算（バインドポーズのT字と実ポーズのズレを防ぐ）
  function computeBounds(root){
    const box=new THREE.Box3(), tmp=new THREE.Box3();
    root.updateMatrixWorld(true);
    root.traverse(o=>{
      if(o.userData.isOutline)return;
      if(o.isSkinnedMesh){ o.computeBoundingBox(); tmp.copy(o.boundingBox).applyMatrix4(o.matrixWorld); box.union(tmp); }
      else if(o.isMesh){ if(!o.geometry.boundingBox)o.geometry.computeBoundingBox(); tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld); box.union(tmp); }
    });
    return box;
  }
  function activate(name,fade){
    const next=actions[name]; if(!next||next===active)return;
    next.reset(); next.setEffectiveTimeScale(1); next.setEffectiveWeight(1); next.play();
    if(active&&fade) active.crossFadeTo(next,fade,false);
    else if(active) active.stop();
    active=next; activeName=name;
    if(clipBox)[...clipBox.querySelectorAll("button")].forEach(b=>b.classList.toggle("on",b.dataset.clip===name));
  }
  loader.load(GLB,(gltf)=>{
    const model=gltf.scene; modelRef=model;
    if(TOON) toonifyModel(model);
    model.traverse(o=>{ if(o.isMesh&&!o.userData.isOutline){
      o.userData.matOrig=o.material;
      if(o.isSkinnedMesh)o.frustumCulled=false;
      if(!TOON&&o.material&&o.material.envMapIntensity!=null)o.material.envMapIntensity=ENVI;
      if(o.morphTargetInfluences)o.userData.morphOrig=o.morphTargetInfluences.slice();
    }});
    scene.add(model);

    // アニメーション：全クリップを登録（先頭を再生）。フレーミングは全クリップの実ポーズを収める
    const clips=gltf.animations||[];
    let box;
    if(clips.length){
      mixer=new THREE.AnimationMixer(model);
      box=new THREE.Box3();
      clips.forEach(clip=>{
        mixer.stopAllAction();
        const a=mixer.clipAction(clip); a.reset(); a.play();
        const dur=clip.duration||1;
        for(const t of [0,.2,.4,.6,.8,.999]){ mixer.setTime(t*dur); box.union(computeBounds(model)); }
      });
      mixer.stopAllAction(); mixer.setTime(0);
      clips.forEach(clip=>{ actions[clip.name]=mixer.clipAction(clip); });
      if(clipBox&&clips.length>1){
        clipBox.innerHTML="";
        clips.forEach(c=>{
          const b=document.createElement("button"); b.type="button"; b.dataset.clip=c.name; b.textContent=c.name;
          b.addEventListener("click",()=>{ if(mode!=="wire")activate(c.name,0.35); });
          clipBox.appendChild(b);
        });
      }
      activate(clips[0].name,0);
    }else{
      box=computeBounds(model);
    }

    const size=box.getSize(new THREE.Vector3()), center=box.getCenter(new THREE.Vector3());
    const maxDim=Math.max(size.x,size.y,size.z);
    controls.target.copy(center);
    const dist=(maxDim/2)/Math.tan((camera.fov*Math.PI/180)/2)*ZOOM;
    const a=ANGLE*Math.PI/180;
    camera.position.set(center.x+dist*Math.sin(a), center.y+dist*ELEV, center.z+dist*Math.cos(a));
    camera.near=maxDim/100; camera.far=maxDim*20; camera.updateProjectionMatrix();
    controls.update();
    homeCenter=center.clone(); homeDist=camera.position.distanceTo(center); sceneMaxDim=maxDim;

    applyMode();
    holder.style.backgroundImage="";
    if(spin)spin.classList.add("off");
  },(e)=>{
    if(e&&e.total&&spinTxt){ spinTxt.textContent="読み込み中 "+Math.round(100*e.loaded/e.total)+"%"; }
  },(err)=>{
    if(spinTxt)spinTxt.textContent="読み込みに失敗しました"; console.error(err);
  });

  // ---- モードUI ----
  const modeBtns=modeBox?[...modeBox.querySelectorAll("button")]:[];
  function applyMode(){
    if(modelRef){
      if(mode==="wire"){
        if(WIREPOSE==="bind"&&mixer){
          // 元の（バインド／T）ポーズで静止し、その頂点からワイヤーを生成
          mixer.stopAllAction();
          modelRef.traverse(o=>{ if(o.isSkinnedMesh&&o.skeleton&&!o.userData.isOutline)o.skeleton.pose(); });
          modelRef.traverse(o=>{ if(o.isMesh&&o.userData.morphOrig&&o.morphTargetInfluences){
            const mo=o.userData.morphOrig; for(let i=0;i<mo.length;i++)o.morphTargetInfluences[i]=mo[i];
          }});
          modelRef.updateMatrixWorld(true);
          buildWires("bind");
        }else{
          // 先頭フレーム(0秒)の実ポーズで静止し、その変形後頂点からワイヤーを生成
          if(mixer&&active){ mixer.stopAllAction(); active.reset(); active.play(); mixer.setTime(0); }
          modelRef.updateMatrixWorld(true);
          buildWires(activeName||"static");
        }
      }else{
        // ノーマル復帰：元のシェイプキー値に戻す（以降はmixerが動かす）
        modelRef.traverse(o=>{ if(o.isMesh&&o.userData.morphOrig&&o.morphTargetInfluences){
          const mo=o.userData.morphOrig; for(let i=0;i<mo.length;i++)o.morphTargetInfluences[i]=mo[i];
        }});
        // バインド静止から戻る場合はアクションを再開する
        if(WIREPOSE==="bind"&&mixer&&active){ active.reset(); active.play(); mixer.setTime(0); }
      }
      modelRef.traverse(o=>{ if(o.isMesh&&o.userData.matOrig&&!o.userData.isOutline){
        o.material=(mode==="wire")?clayMat:o.userData.matOrig;
      }});
      wires.forEach(w=>w.visible=(mode==="wire"));
      outlines.forEach(ol=>ol.visible=(mode!=="wire"));
    }
    modeBtns.forEach(b=>b.classList.toggle("on",b.dataset.mode===mode));
  }
  modeBtns.forEach(b=>b.addEventListener("click",()=>{mode=b.dataset.mode; applyMode();}));

  resize();
  const _L=new THREE.Vector3(), _R=new THREE.Vector3(), _UP=new THREE.Vector3(0,1,0), _D=new THREE.Vector3();
  renderer.setAnimationLoop(()=>{
    const dt=clock.getDelta();
    // タップリセンターのグライド：ターゲットとカメラを同じ差分で動かす（向き・距離を保持）
    if(goalTarget){
      const k=1-Math.exp(-dt*20);   // model-viewerのDamper（減衰50ms）相当
      _D.copy(goalTarget).sub(controls.target).multiplyScalar(k);
      controls.target.add(_D); camera.position.add(_D);
      if(controls.target.distanceToSquared(goalTarget)<sceneMaxDim*sceneMaxDim*1e-8) goalTarget=null;
    }
    if(goalRadius!=null){
      const cur=camera.position.distanceTo(controls.target);
      const nr=cur+(goalRadius-cur)*(1-Math.exp(-dt*20));
      camera.position.sub(controls.target).setLength(nr).add(controls.target);
      if(Math.abs(nr-goalRadius)<sceneMaxDim*1e-4) goalRadius=null;
    }
    controls.update();
    if(mixer&&mode!=="wire")mixer.update(dt);
    if(TOON&&toonMats.length){
      _L.copy(camera.position).sub(controls.target).normalize();
      _R.setFromMatrixColumn(camera.matrixWorld,0);
      _L.addScaledVector(_R,TOON_LIGHT.x).addScaledVector(_UP,TOON_LIGHT.y).normalize();
      for(const m of toonMats) m.uniforms.uLightDir.value.copy(_L);
    }
    renderer.render(scene,camera);
  });
}

// ===== 全ビューアを検出。ポスターは即時、WebGLとGLBは画面に近づいてから =====
document.querySelectorAll("#gviewer, .gv3d").forEach(holder=>{
  if(holder.dataset.poster){
    holder.style.backgroundImage="url('"+holder.dataset.poster+"')";
    holder.style.backgroundSize="cover"; holder.style.backgroundPosition="center";
  }
  if("IntersectionObserver" in window){
    const io=new IntersectionObserver((es)=>{
      es.forEach(e=>{ if(e.isIntersecting){ io.disconnect(); initViewer(holder); } });
    },{rootMargin:"600px"});
    io.observe(holder);
  }else{
    initViewer(holder);
  }
});
