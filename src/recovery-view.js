// Both renderers observe the same received samples. No interpolation, separate
// vehicle dynamics or collision model is introduced by drawing the common yard.
const NS = 'http://www.w3.org/2000/svg';
const COLORS = { A1: '#a9e5c9', A2: '#edc08c', A3: '#abc9fa' };
const svgNode = (tag, attrs = {}, text = '') => {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  node.textContent = text; return node;
};
const worldPoint = ([east, north, up]) => [east, up, -north];
export function createRecoveryView(container, { onModeChange = () => {} } = {}) {
  let recording, frame, selected = 'A1', mode = '2d', world, loading = false, failed = false, disposed = false, cameraMode = 'yard';
  const svg = svgNode('svg', { viewBox: '0 0 850 500', class: 'recovery-svg', role: 'img', 'aria-label': 'Three recorded vehicles in supplied mission ENU layout, with overhead map and separate elevation views.' });
  const layer = Object.assign(document.createElement('div'), { className: 'recovery-three', hidden: true }); container.append(svg, layer);
  function drawSvg() {
    if (!frame || disposed) return;
    svg.replaceChildren(); const map = ([e,n]) => [280 + e * 28, 365 - n * 23], elevation = u => 372 - u * 52;
    svg.append(svgNode('rect', {x:18,y:18,width:532,height:411,rx:8,fill:'#223d34',stroke:'#657e66'}), svgNode('rect',{x:565,y:18,width:267,height:411,rx:8,fill:'#223d34',stroke:'#657e66'}));
    for (let e=-8;e<=8;e+=2) svg.append(svgNode('line',{x1:map([e,0])[0],x2:map([e,0])[0],y1:54,y2:401,stroke:'#657e66',opacity:.35}));
    for (let n=0;n<=12;n+=2) svg.append(svgNode('line',{x1:55,x2:505,y1:map([0,n])[1],y2:map([0,n])[1],stroke:'#657e66',opacity:.35}));
    svg.append(svgNode('text',{x:35,y:43,fill:'#d4e6cf','font-size':12},'MISSION LAYOUT / ENU'),svgNode('text',{x:280,y:416,fill:'#b9cfb3','text-anchor':'middle','font-size':11},'East → · North ↑ · metres'),svgNode('text',{x:582,y:43,fill:'#d4e6cf','font-size':12},'RECEIVED LOCAL HEIGHT'));
    for(let h=0;h<=6;h++) svg.append(svgNode('line',{x1:605,x2:814,y1:elevation(h),y2:elevation(h),stroke:'#748e72',opacity:.35}),svgNode('text',{x:595,y:elevation(h)+4,fill:'#c0d6ba','font-size':11,'text-anchor':'end'},`${h} m`));
    for(const task of recording.tasks){const [x,y]=map(task.positionEnu);const state=frame.tasks.find(t=>t.id===task.id);svg.append(svgNode('circle',{cx:x,cy:y,r:13,fill:state?.state==='completed'?'#517857':'none',stroke:state?.state==='locked'?'#f1a481':COLORS[state?.ownerId]??'#d7c5a0','stroke-width':2,'stroke-dasharray':'3 3'}),svgNode('text',{x:x+20,y:y-13,fill:'#e0d6b8','font-size':12},`${task.id}${state?.state==='completed'?' ✓':state?.state==='locked'?' ⊘':''} · 4 m`));}
    for(const v of frame.vehicles){
      const color=COLORS[v.id]??'#c6ded0', [px,py]=map(v.padEnu); svg.append(svgNode('circle',{cx:px,cy:py,r:19,fill:'#142d24',stroke:color}),svgNode('text',{x:px,y:py+5,fill:color,'font-size':13,'text-anchor':'middle'},'H'),svgNode('text',{x:px,y:py+35,fill:color,'font-size':11,'text-anchor':'middle'},`${v.id} / SYS ${v.systemId}`));
      if(v.taskTargetEnu){const [tx,ty]=map(v.taskTargetEnu);svg.append(svgNode('line',{x1:px,y1:py,x2:tx,y2:ty,stroke:color,'stroke-dasharray':v.taskState==='locked'?'2 8':'5 5',opacity:.5}));}
      const path=v.trajectoryEnu.map(s=>map(s.positionEnu).join(',')).join(' ');if(path)svg.append(svgNode('polyline',{points:path,fill:'none',stroke:color,'stroke-width':2,opacity:.7}));
      if(!v.positionEnu)continue;
      const [x,y]=map(v.positionEnu), g=svgNode('g',{transform:`translate(${x} ${y})`,'data-recovery-svg-vehicle':v.id,'data-position':JSON.stringify(v.positionEnu)});
      if(v.id===selected)g.append(svgNode('circle',{r:24,fill:'none',stroke:color,'stroke-width':1.5}));
      g.append(svgNode('path',{d:'M-15 0H15M0-15V15',stroke:color,'stroke-width':4}));for(const [a,b]of[[-15,0],[15,0],[0,-15],[0,15]])g.append(svgNode('circle',{cx:a,cy:b,r:7,fill:'#15372a',stroke:color,'stroke-width':2}));g.append(svgNode('rect',{x:-6,y:-6,width:12,height:12,rx:3,fill:color}));svg.append(g,svgNode('text',{x:x+25,y:y+6,fill:color,'font-size':11},v.id));
      const ex=626 + ['A1','A2','A3'].indexOf(v.id) * 81,ey=elevation(v.positionEnu[2]-v.padEnu[2]);const eg=svgNode('g',{transform:`translate(${ex} ${ey})`,'data-recovery-svg-elevation':v.id,'data-position':JSON.stringify(v.positionEnu)});eg.append(svgNode('path',{d:'M-27 0H27M-12 4L-18 13H18L12 4',fill:'none',stroke:color,'stroke-width':3}),svgNode('rect',{x:-12,y:-7,width:24,height:13,rx:3,fill:color}));for(const rx of[-27,27])eg.append(svgNode('ellipse',{cx:rx,cy:-3,rx:13,ry:3,fill:'#15352a',stroke:color}));svg.append(eg,svgNode('text',{x:ex,y:398,fill:color,'font-size':11,'text-anchor':'middle'},`${v.id} · ${(v.positionEnu[2]-v.padEnu[2]).toFixed(2)} m`));
    }
    svg.append(svgNode('text',{x:26,y:455,fill:'#c4d7c2','font-size':11},'SUPPLIED PAD OFFSETS + RECEIVED LOCAL ESTIMATES · ONE SHARED REPLAY CURSOR'),svgNode('text',{x:26,y:478,fill:'#b4c7ad','font-size':10},'Independent SITL dynamics. No shared collision world or peer avoidance. Dashed lines show task ownership.'));
  }
  function disposeWorld(){if(!world)return;world.controls.dispose();const geometries=new Set(),materials=new Set();world.scene.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(Array.isArray(o.material))o.material.forEach(m=>materials.add(m));else if(o.material)materials.add(o.material);o.shadow?.dispose();});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());world.renderer.dispose();world=null;}
  function unavailable(message){failed=true;disposeWorld();layer.replaceChildren();mode='2d';svg.removeAttribute('hidden');layer.hidden=true;container.dataset.view='2d';onModeChange('2d',`${message} All three recorded vehicles remain available in 2D with all identity and task inspectors.`);}
  async function prepareThree(){
    if(world||loading||failed||disposed)return;loading=true;layer.replaceChildren(Object.assign(document.createElement('p'),{className:'recovery-webgl-message',textContent:'Preparing the three-vehicle yard…'}));let pendingRenderer;
    try{
      const [THREE,{OrbitControls}]=await Promise.all([import('three'),import('three/addons/controls/OrbitControls.js')]);if(disposed||mode!=='3d')return;
      const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});pendingRenderer=renderer;renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.08;
      renderer.domElement.setAttribute('aria-label','3D three-vehicle mission yard showing recorded autopilot position and attitude estimates. Drag to orbit; focus and use arrow keys to pan.');renderer.domElement.tabIndex=0;renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();unavailable('The 3D graphics context was lost.');});layer.replaceChildren(renderer.domElement);
      const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(43,1,.1,200),controls=new OrbitControls(camera,renderer.domElement);controls.minDistance=2;controls.maxDistance=70;controls.maxPolarAngle=Math.PI/2-.015;controls.listenToKeyEvents(renderer.domElement);
      scene.add(new THREE.HemisphereLight(0xe1eee0,0x344c38,2.8));const sun=new THREE.DirectionalLight(0xffedcc,3.5);sun.position.set(-9,19,8);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-18,right:18,top:18,bottom:-18,far:55});sun.shadow.normalBias=.025;scene.add(sun);const fill=new THREE.DirectionalLight(0xa7cabb,1);fill.position.set(10,6,-14);scene.add(fill);
      const mat=(color,extras={})=>new THREE.MeshStandardMaterial({color,roughness:.8,...extras});const dark=mat(0x17362a),concrete=mat(0x87917a),pale=mat(0xdadbc0),metal=mat(0x8d9f91,{metalness:.6,roughness:.4});
      const mesh=(geometry,material,p,parent=scene,name='')=>{const o=new THREE.Mesh(geometry,material);o.position.set(...p);o.castShadow=true;o.receiveShadow=true;o.name=name;parent.add(o);return o;};const box=(size,material,p,parent=scene,name='')=>mesh(new THREE.BoxGeometry(...size),material,p,parent,name);const cylinder=(r,h,material,p,parent=scene)=>mesh(new THREE.CylinderGeometry(r,r,h,24),material,p,parent);
      const beam=(a,b,r,material,parent=scene)=>{const from=new THREE.Vector3(...a),to=new THREE.Vector3(...b),delta=to.clone().sub(from);const o=mesh(new THREE.CylinderGeometry(r,r,delta.length(),10),material,from.clone().add(to).multiplyScalar(.5).toArray(),parent);o.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());return o;};
      const line=(points,color,dashed=false,opacity=1)=>{const material=dashed?new THREE.LineDashedMaterial({color,dashSize:.25,gapSize:.2,transparent:true,opacity}):new THREE.LineBasicMaterial({color,transparent:true,opacity});const o=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(p=>new THREE.Vector3(...p))),material);if(dashed)o.computeLineDistances();scene.add(o);return o;};
      box([20,.36,22],dark,[0,-.54,-5]);box([19.85,.08,21.85],concrete,[0,-.32,-5]);const grid=mat(0x697f66);for(let x=-9;x<=9;x++)box([.012,.006,21.5],grid,[x,-.273,-5]);for(let z=-15;z<=5;z++)box([19.5,.006,.012],grid,[0,-.273,z]);
      for(const [x,z]of[[-9,5.7],[9,5.7],[-9,-15.7],[9,-15.7]]){cylinder(.09,.65,mat(0xd4af73),[x,.05,z]);cylinder(.095,.13,dark,[x,.15,z]);}
      function makeDrone(id,color){
      const drone = new THREE.Group(); drone.name = `${id}-received-autopilot-pose`; scene.add(drone);
      // Model axes: +X nose/forward, +Y up, +Z right. Orientation below
      // converts this basis to FRD before applying recorded NED Euler angles.
      const shell = mat(color, { metalness: .25, roughness: .35 });
      box([.57, .18, .37], shell, [0, 0, 0], drone); box([.32, .06, .29], pale, [-.03, .12, 0], drone); box([.31, .075, .28], dark, [-.07, -.115, 0], drone);
      const rotors = [];
      for (const [x, z] of [[-.56, 0], [.56, 0], [0, -.56], [0, .56]]) {
        beam([x * .25, 0, z * .3], [x, .025, z], .035, dark, drone); cylinder(.075, .115, metal, [x, .08, z], drone);
        const rotor = new THREE.Group(); rotor.position.set(x, .15, z); drone.add(rotor); rotors.push(rotor); box([.51, .012, .056], dark, [0, 0, 0], rotor); cylinder(.035, .03, pale, [0, .015, 0], rotor); rotor.rotation.y = x * z > 0 ? .35 : -.7;
        const ring = mesh(new THREE.RingGeometry(.23, .24, 32), new THREE.MeshBasicMaterial({ color: 0xc3e8ce, transparent: true, opacity: .25, side: THREE.DoubleSide }), [x, .15, z], drone); ring.rotation.x = Math.PI / 2; ring.castShadow = false;
        cylinder(.026, .025, mat(x > 0 ? 0xe9be78 : 0x7ed3aa, { emissive: x > 0 ? 0x986e28 : 0x3b7a58, emissiveIntensity: .5 }), [x, -.012, z], drone);
      }
      for (const z of [-.23, .23]) { for (const x of [-.17, .17]) beam([x, -.08, z * .7], [x, -.25, z], .02, metal, drone); beam([-.32, -.25, z], [.32, -.25, z], .022, dark, drone); }
      mesh(new THREE.SphereGeometry(.075, 16, 12), metal, [.23, -.14, 0], drone); const lens = cylinder(.045, .09, dark, [.285, -.145, 0], drone); lens.rotation.z = Math.PI / 2; const glass = mesh(new THREE.CircleGeometry(.035, 20), mat(0x8dd7c1, { metalness: .4, roughness: .15 }), [.334, -.145, 0], drone); glass.rotation.y = Math.PI / 2;

        return drone;
      }
      const vehicles={};
      for(const v of recording.vehicles){
        const color=COLORS[v.id], [e,n,u]=v.padEnu;const padMat=mat(color);cylinder(1,.055,dark,[e,u-.246,-n]);const ring=mesh(new THREE.TorusGeometry(.79,.03,8,64),padMat,[e,u-.214,-n]);ring.rotation.x=Math.PI/2;for(const dx of[-.23,.23])box([.075,.015,.65],padMat,[e+dx,u-.207,-n]);box([.53,.015,.075],padMat,[e,u-.207,-n]);
        const drone=makeDrone(v.id,color),trail=line([[0,0,0],[0,0,0]],color,false,.9),vertical=line([[0,0,0],[0,0,0]],color,true,.6),assignment=line([[0,0,0],[0,0,0]],color,true,.65);
        const ground=mesh(new THREE.RingGeometry(.35,.39,48),new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide,transparent:true,opacity:.8}),[e,u-.19,-n]);ground.rotation.x=Math.PI/2;ground.castShadow=false;
        vehicles[v.id]={drone,trail,vertical,assignment,ground,pathCount:-1};
      }
      const taskObjects={};
      for(const task of recording.tasks){const [e,n,u]=task.positionEnu;const target=mesh(new THREE.OctahedronGeometry(.3),new THREE.MeshBasicMaterial({color:0xe4c28d,wireframe:true}),[e,u,-n]);const ring=mesh(new THREE.TorusGeometry(.55,.025,8,48),mat(0xd8ae74),[e,-.2,-n]);ring.rotation.x=Math.PI/2;line([[e,-.19,-n],[e,u,-n]],'#d4b380',true,.45);
        // A visible inspection prop beside the supplied point, not collision geometry.
        const tower=new THREE.Group();tower.position.set(e+1.5,-.27,-n-1);scene.add(tower);box([.65,.18,.65],dark,[0,.09,0],tower);for(const [x,z]of[[-.21,-.21],[.21,-.21],[-.21,.21],[.21,.21]])beam([x,.1,z],[x,2.1,z],.035,metal,tower);for(const h of[.25,1.15,2]){beam([-.21,h,-.21],[.21,h+.8,-.21],.023,metal,tower);beam([.21,h,.21],[-.21,h+.8,.21],.023,metal,tower);}box([.75,.5,.65],mat(0x637d68),[0,2.5,0],tower);box([.5,.25,.03],mat(0xabc2a4),[0,2.52,.34],tower);cylinder(.05,.5,metal,[0,3,0],tower);taskObjects[task.id]={target,ring};}
      const station=new THREE.Group();station.position.set(0,-.27,3.8);scene.add(station);box([1.8,.74,.85],dark,[0,.37,0],station);box([1.96,.09,1],metal,[0,.79,0],station);for(const [x,color]of[[-.6,0xa9e5c9],[0,0xedc08c],[.6,0xabc9fa]]){box([.77,.5,.06],dark,[x,1.1,-.15],station);box([.64,.35,.015],mat(color,{emissive:color,emissiveIntensity:.1}),[x,1.1,-.11],station);box([.7,.035,.35],pale,[x,.85,.2],station);for(let j=0;j<4;j++)box([.59,.008,.018],dark,[x,.875,.1+j*.06],station);}cylinder(.035,2,metal,[-1.15,.8,0],station);cylinder(.07,.1,pale,[-1.15,1.8,0],station);for(const angle of[0,2.1,4.2])beam([-1.15,.4,0],[-1.15+Math.cos(angle)*.35,.02,Math.sin(angle)*.35],.02,metal,station);
      const shed=new THREE.Group();shed.position.set(7.9,-.27,-3);scene.add(shed);box([2.5,1.6,2.8],mat(0x526d5b),[0,.8,0],shed);box([2.75,.13,3],pale,[0,1.67,0],shed);box([.85,1.25,.04],dark,[-.5,.65,1.42],shed);box([.75,.48,.04],mat(0x83af9a),[.52,1.05,1.43],shed);
      const overlay=Object.assign(document.createElement('div'),{className:'recovery-labels'}),labels={};for(const v of recording.vehicles){const label=Object.assign(document.createElement('span'),{className:'recovery-scene-label'});label.dataset.vehicle=v.id;overlay.append(label);labels[v.id]=label;}for(const task of recording.tasks){const label=Object.assign(document.createElement('span'),{className:'recovery-scene-label recovery-memory',textContent:task.id});overlay.append(label);labels[task.id]=label;}layer.append(overlay);
      const cameras=Object.assign(document.createElement('div'),{className:'recovery-camera'});cameras.setAttribute('role','group');cameras.setAttribute('aria-label','3D camera framing');const yardButton=Object.assign(document.createElement('button'),{id:'recovery-camera-yard',textContent:'Whole yard'}),closeButton=Object.assign(document.createElement('button'),{id:'recovery-camera-close',textContent:'Follow A1'});cameras.append(yardButton,closeButton);layer.append(cameras);layer.append(Object.assign(document.createElement('span'),{className:'recovery-scene-caption',textContent:'RECEIVED ESTIMATES · SUPPLIED MISSION LAYOUT · ILLUSTRATIVE YARD · NO SHARED COLLISION PHYSICS'}));
      const nedToWorld=new THREE.Matrix4().set(0,1,0,0,0,0,-1,0,-1,0,0,0,0,0,0,1),modelToFrd=new THREE.Matrix4().set(1,0,0,0,0,0,1,0,0,-1,0,0,0,0,0,1);
      world={THREE,renderer,scene,camera,controls,vehicles,taskObjects,labels,yardButton,closeButton,nedToWorld,modelToFrd};controls.addEventListener('change',drawThree);yardButton.addEventListener('click',()=>frameCamera('yard'));closeButton.addEventListener('click',()=>frameCamera('vehicle'));resize();frameCamera(cameraMode);updateThree();
    }catch{if(!world)pendingRenderer?.dispose();if(!disposed)unavailable('3D is unavailable; WebGL 2 is required.');}finally{loading=false;}
  }
  function setLine(object,points){object.geometry.dispose();object.geometry=new world.THREE.BufferGeometry().setFromPoints(points.map(p=>new world.THREE.Vector3(...p)));if(object.material.isLineDashedMaterial)object.computeLineDistances();}
  function updateThree(){
    if(!world||!frame||failed||disposed)return;const {THREE}=world;
    for(const v of frame.vehicles){const object=world.vehicles[v.id];if(!object)continue;const point=v.positionEnu?worldPoint(v.positionEnu):null;object.drone.visible=object.ground.visible=object.vertical.visible=Boolean(point);const label=world.labels[v.id];label.textContent=`${v.id} / SYS ${v.systemId} · ${v.mode??'waiting'}${v.positionEnu?` · ${v.positionEnu[2].toFixed(2)} m`:''}`;label.dataset.selected=String(v.id===selected);
      if(point){object.drone.position.set(...point);const a=v.attitude??{roll:0,pitch:0,yaw:0},rotation=new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(a.roll,a.pitch,a.yaw,'ZYX'));object.drone.quaternion.setFromRotationMatrix(world.nedToWorld.clone().multiply(rotation).multiply(world.modelToFrd));object.drone.userData.attitudeAvailable=Boolean(v.attitude);object.ground.position.set(point[0],v.padEnu[2]-.19,point[2]);setLine(object.vertical,[[point[0],v.padEnu[2]-.18,point[2]],point]);if(cameraMode==='vehicle'&&v.id===selected){const follow=new THREE.Vector3(...point);world.camera.position.add(follow.clone().sub(world.controls.target));world.controls.target.copy(follow);world.controls.update();}}
      if(object.pathCount!==v.trajectoryEnu.length||object.pathRun!==recording){const points=v.trajectoryEnu.map(s=>worldPoint(s.positionEnu));setLine(object.trail,points.length?points:[[0,0,0]]);object.pathCount=v.trajectoryEnu.length;object.pathRun=recording;}
      object.assignment.visible=Boolean(v.taskTargetEnu);if(v.taskTargetEnu)setLine(object.assignment,[worldPoint(v.positionEnu??v.padEnu),worldPoint(v.taskTargetEnu)]);
    }
    for(const task of frame.tasks){const done=task.state==='completed',locked=task.state==='locked',color=done?'#a9e5c9':locked?'#f1a481':COLORS[task.ownerId]??'#e4c28d';world.taskObjects[task.id].target.material.color.set(color);world.taskObjects[task.id].ring.material.color.set(color);world.labels[task.id].textContent=`${task.id}${task.ownerId?` · ${task.ownerId}`:''}${done?' · complete':locked?' · locked':''}`;world.labels[task.id].dataset.state=task.state;}
    world.closeButton.textContent=`Follow ${selected}`;drawThree();
  }
  function frameCamera(next){if(!world||!frame||disposed)return;cameraMode=next;world.yardButton.setAttribute('aria-pressed',String(next==='yard'));world.closeButton.setAttribute('aria-pressed',String(next==='vehicle'));if(next==='yard'){const factor=Math.max(1,1.05/world.camera.aspect);world.controls.target.set(0,1.7,-5);world.camera.position.set(16*factor,17*factor,19*factor);}else{const v=frame.vehicles.find(v=>v.id===selected),[x,y,z]=v?.positionEnu?worldPoint(v.positionEnu):worldPoint(v?.padEnu??[0,0,0]);world.controls.target.set(x,y,z);world.camera.position.set(x-4,y+3,z+4.8);}world.controls.update();drawThree();}
  function drawThree(){
    if(!world||mode!=='3d'||!frame||disposed||failed)return;
    const width=container.clientWidth,height=container.clientHeight,compact=width<580;
    const project=point=>{
      if(!point)return null;
      const p=new world.THREE.Vector3(...worldPoint(point)).project(world.camera);
      return p.z<-1||p.z>1||Math.abs(p.x)>1||Math.abs(p.y)>1?null:{x:(p.x+1)*width/2,y:(1-p.y)*height/2};
    };
    const caption=layer.querySelector('.recovery-scene-caption');
    caption.textContent=compact?'ESTIMATED POSES · INDEPENDENT SITL WORLDS':'RECEIVED ESTIMATES · SUPPLIED MISSION LAYOUT · ILLUSTRATIVE YARD · NO SHARED COLLISION PHYSICS';
    const cameras=layer.querySelector('.recovery-camera');
    const topEdge=cameras.offsetTop+cameras.offsetHeight+8,bottomEdge=caption.offsetTop-8;
    const overlaps=(a,b)=>a.left<b.left+b.w+5&&a.left+a.w+5>b.left&&a.top<b.top+b.h+5&&a.top+a.h+5>b.top;
    // Reserve the aircraft silhouettes before placing any labels. Compact task
    // labels are lower priority; if no free nearby slot exists, leave the
    // marker visible and let the task ledger supply the full text below.
    const silhouettes=frame.vehicles.flatMap(v=>{
      const point=project(v.positionEnu);if(!point)return[];
      const radius=cameraMode==='vehicle'&&v.id===selected?52:compact?12:23;
      return[{left:point.x-radius,top:point.y-radius*.7,w:radius*2,h:radius*1.4}];
    });
    const vehicles=[...frame.vehicles].sort((a,b)=>Number(b.id===selected)-Number(a.id===selected));
    const entries=[...vehicles.map(v=>({id:v.id,point:v.positionEnu,vehicle:true,text:`${v.id}${v.positionEnu?` · ${v.positionEnu[2].toFixed(2)} m`:''}`})),
      ...frame.tasks.map(t=>({id:t.id,point:t.positionEnu,vehicle:false,text:`${t.id}${t.state==='completed'?' ✓':t.state==='locked'?' ⊘':!compact&&t.ownerId?` · ${t.ownerId}`:''}`}))];
    const occupied=[];
    for(const entry of entries){
      const label=world.labels[entry.id],point=project(entry.point);
      label.textContent=entry.text;label.hidden=!point||(cameraMode==='vehicle'&&entry.vehicle&&entry.id!==selected);
      if(label.hidden)continue;
      const w=label.offsetWidth,h=label.offsetHeight;
      const gap=entry.vehicle?(cameraMode==='vehicle'?49:compact?22:32):17;
      const candidates=[
        [point.x-w/2,point.y-gap-h], [point.x-w/2,point.y+gap],
        [point.x+gap,point.y-h/2], [point.x-gap-w,point.y-h/2],
        [point.x-w/2,point.y-gap-h-30], [point.x-w/2,point.y+gap+30],
        [point.x+gap,point.y-gap-h], [point.x-gap-w,point.y-gap-h],
        [point.x+gap,point.y+gap], [point.x-gap-w,point.y+gap],
      ].map(([left,top])=>({left:Math.max(6,Math.min(width-w-6,left)),top,w,h}));
      const position=candidates.find(box=>box.top>=topEdge&&box.top+box.h<=bottomEdge
        &&![...occupied,...silhouettes].some(other=>overlaps(box,other)));
      label.hidden=!position;
      if(position){label.style.left=`${position.left}px`;label.style.top=`${position.top}px`;occupied.push(position);}
    }
    world.renderer.render(world.scene,world.camera);
  }
  function resize(){if(!world||disposed)return;world.renderer.setSize(container.clientWidth,container.clientHeight,false);world.camera.aspect=container.clientWidth/Math.max(1,container.clientHeight);world.camera.updateProjectionMatrix();drawThree();}
  const observer=new ResizeObserver(resize);observer.observe(container);
  return{
    update(nextRun,nextFrame,nextSelected='A1'){const changed=selected!==nextSelected;recording=nextRun;frame=nextFrame;selected=nextSelected;Object.assign(container.dataset,{case:recording.id,timeMs:String(frame.timeMs),selected,view:mode,vehicles:JSON.stringify(frame.vehicles.map(v=>({id:v.id,positionEnu:v.positionEnu,positionNed:v.positionNed,attitude:v.attitude,mode:v.mode,armed:v.armed,taskId:v.taskId,retiring:v.taskState==='locked'}))),tasks:JSON.stringify(frame.tasks),tasksCompleted:String(frame.tasksCompleted),landedVehicles:String(frame.landedVehicles)});drawSvg();updateThree();if(changed&&cameraMode==='vehicle')frameCamera('vehicle');},
    setMode(next){if(disposed)return;if(next==='3d'&&failed){unavailable('3D remains unavailable in this session.');return;}mode=next;container.dataset.view=mode;svg.toggleAttribute('hidden',mode==='3d');layer.hidden=mode!=='3d';onModeChange(mode);if(mode==='3d'){if(world){resize();updateThree();}else prepareThree();}},
    dispose(){disposed=true;observer.disconnect();disposeWorld();}
  };
}
