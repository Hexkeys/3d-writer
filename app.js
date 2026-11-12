import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js";
pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

const $ = (id) => document.getElementById(id);
const canvas = $("preview");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
let pdfDoc = null;
let sourceCanvas = null;
let renderBusy = false;

const number = (id) => {
  const value = Number($(id).value);
  if (!Number.isFinite(value)) throw new Error("Please enter valid numeric settings.");
  return value;
};
const settings = () => ({
  threshold: number("threshold"), invert: $("invert").checked,
  bedWidth: number("bedWidth"), bedHeight: number("bedHeight"), margin: number("margin"),
  lineSpacing: number("lineSpacing"), originX: number("originX"), originY: number("originY"),
  offsetX: number("offsetX"), offsetY: number("offsetY"), offsetZ: number("offsetZ"), penUp: number("penUp"), penDown: number("penDown"),
  travelFeed: number("travelFeed"), drawFeed: number("drawFeed"), zFeed: number("zFeed"),
  profile: $("machineProfile").value
});
function validate(s) {
  if (s.bedWidth <= 0 || s.bedHeight <= 0 || s.bedWidth > 256 || s.bedHeight > 256 || s.margin < 0 || s.bedWidth <= 2*s.margin || s.bedHeight <= 2*s.margin) throw new Error("The Bambu Lab A1 build area is 256 × 256 mm. Bed dimensions must stay within that limit and be larger than twice the margin.");
  if (s.lineSpacing <= 0 || s.travelFeed <= 0 || s.drawFeed <= 0 || s.zFeed <= 0) throw new Error("Line spacing and feed rates must be greater than zero.");
  if (s.threshold < 0 || s.threshold > 255) throw new Error("Threshold must be between 0 and 255.");
  if (s.profile === "bambu-a1") {
    if (!$("a1CalibrationAck").checked) throw new Error("A1 export is locked until you confirm that the pen offsets, Z heights, coordinate origin, and physical clearance have been measured and independently checked.");
    if (!$("penUp").value.trim() || !$("penDown").value.trim()) throw new Error("Enter measured pen-up and pen-down Z values for the A1 profile; generic defaults are not accepted.");
    if (s.penUp <= s.penDown) throw new Error("For this profile, the measured pen-up Z must be higher than the pen-down Z.");
    if (s.bedWidth > 180 || s.bedHeight > 180) throw new Error("The A1 review profile limits the initial drawing envelope to 180 × 180 mm. This is only a conservative software limit, not a verified keep-out map.");
  }
}
function updateMachineProfile() {
  const isA1 = $("machineProfile").value === "bambu-a1";
  $("a1ProfileWarning").hidden = !isA1;
  $("a1CalibrationAck").checked = false;
  if (isA1) {
    $("bedWidth").value = "180";
    $("bedHeight").value = "180";
    $("margin").value = "10";
    $("penUp").value = "";
    $("penDown").value = "";
    $("status").textContent = "A1 review profile selected. Enter measured Z values and confirm all physical calibration checks before exporting.";
  } else {
    $("penUp").value = "5";
    $("penDown").value = "0";
    $("status").textContent = "Generic profile selected.";
  }
  try { drawPreview(); } catch (e) { /* no source loaded yet */ }
}
$("machineProfile").addEventListener("change", updateMachineProfile);
$("a1CalibrationAck").addEventListener("change", () => {
  try { drawPreview(); } catch (e) { /* no source loaded yet */ }
});
function drawPreview() {
  if (!sourceCanvas) return;
  const s = settings(); validate(s);
  const w = sourceCanvas.width, h = sourceCanvas.height;
  const data = sourceCanvas.getContext("2d", {willReadFrequently:true}).getImageData(0,0,w,h).data;
  const out = ctx.createImageData(w,h);
  let count = 0;
  for (let i=0;i<data.length;i+=4) {
    const gray = Math.round(.299*data[i]+.587*data[i+1]+.114*data[i+2]);
    const ink = s.invert ? gray > s.threshold : gray <= s.threshold;
    const v = ink ? 30 : 255;
    out.data[i]=ink?26:255; out.data[i+1]=ink?93:255; out.data[i+2]=ink?66:255; out.data[i+3]=255;
    if (ink) count++;
  }
  ctx.putImageData(out,0,0);
  canvas.style.display="block"; $("emptyState").style.display="none";
  $("strokeCount").textContent = count.toLocaleString()+" dark pixels";
}
async function loadPage() {
  if (!pdfDoc || renderBusy) return;
  renderBusy=true;
  try {
    const pageNo=number("page");
    if(!Number.isInteger(pageNo)||pageNo<1||pageNo>pdfDoc.numPages) throw new Error("Page number is outside this PDF.");
    const page=await pdfDoc.getPage(pageNo);
    const dpi=Math.min(300,Math.max(30,number("dpi")));
    const viewport=page.getViewport({scale:dpi/72});
    if(viewport.width*viewport.height>20000000) throw new Error("Rendered page is too large. Try a lower DPI.");
    const tmp=document.createElement("canvas");
    tmp.width=Math.ceil(viewport.width);tmp.height=Math.ceil(viewport.height);
    await page.render({canvas:tmp,viewport}).promise;
    sourceCanvas=tmp;canvas.width=tmp.width;canvas.height=tmp.height;
    $("pageInfo").textContent="Page "+pageNo+" of "+pdfDoc.numPages;
    drawPreview();
    $("status").textContent="PDF page ready. Adjust settings and generate your file.";
  } catch(e){$("status").textContent=e.message;}
  finally{renderBusy=false;}
}
async function decodeImageFile(file) {
  // createImageBitmap is fast, but not available in every browser.
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return { image: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close?.() };
    } catch (error) {
      // Try the HTMLImageElement decoder below (useful on browsers with partial support).
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("This browser cannot decode this image. Try saving it as JPG or PNG."));
      image.src = url;
    });
    return { image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}
async function loadImage(file) {
  const decoded = await decodeImageFile(file);
  try {
    const width = decoded.width, height = decoded.height;
    if (!width || !height) throw new Error("The image has no readable dimensions.");
    const maxPixels = 12000000;
    const scale = Math.min(1, Math.sqrt(maxPixels / (width * height)));
    const tmp = document.createElement("canvas");
    tmp.width = Math.max(1, Math.round(width * scale));
    tmp.height = Math.max(1, Math.round(height * scale));
    const imageContext = tmp.getContext("2d", { willReadFrequently: true });
    if (!imageContext) throw new Error("Your browser could not create an image canvas.");
    imageContext.drawImage(decoded.image, 0, 0, tmp.width, tmp.height);
    sourceCanvas = tmp;
  } finally {
    decoded.close();
  }
  canvas.width = sourceCanvas.width;
  canvas.height = sourceCanvas.height;
  $("pageInfo").textContent = "Image · " + sourceCanvas.width + " × " + sourceCanvas.height;
  $("status").textContent = "Image ready. Adjust the ink threshold and generate your file.";
  drawPreview();
}
$("pdfFile").addEventListener("change",async(event)=>{
  const file=event.target.files?.[0];if(!file)return;
  const isPdf=file.type==="application/pdf"||file.name.toLowerCase().endsWith(".pdf");
  try {
    if(isPdf){
      pdfDoc=await pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise;
      $("pdfOptions").hidden=false;
      $("fileLabel").textContent=file.name;
      $("generate").disabled=false;
      await loadPage();
    } else if(file.type.startsWith("image/")||/\.(jpe?g|png|webp|gif|bmp|avif|tiff?)$/i.test(file.name)){
      pdfDoc=null;
      $("pdfOptions").hidden=true;
      $("fileLabel").textContent=file.name;
      $("generate").disabled=true;
      await loadImage(file);
      $("generate").disabled=false;
    } else {
      throw new Error("Choose a PDF or browser-supported image (JPG, PNG, WEBP, GIF, BMP, AVIF or TIFF).");
    }
  } catch(e){
    $("generate").disabled=true;
    $("status").textContent="Could not open file: "+e.message;
  }
});
$("page").addEventListener("change",loadPage);
$("dpi").addEventListener("change",loadPage);
$("threshold").addEventListener("input",()=>{ $("thresholdOut").value=$("threshold").value; try{drawPreview();}catch(e){$("status").textContent=e.message;} });
$("invert").addEventListener("change",()=>{try{drawPreview();}catch(e){$("status").textContent=e.message;}});
for(const id of ["bedWidth","bedHeight","margin","lineSpacing","originX","originY","offsetX","offsetY","offsetZ","penUp","penDown","travelFeed","drawFeed","zFeed"]) $(id).addEventListener("change",()=>{try{drawPreview();}catch(e){$("status").textContent=e.message;}});

// Keep the three offset sliders and numeric fields synchronized.
for (const axis of ["X","Y","Z"]) {
  const field = $("offset"+axis);
  const slider = $("offset"+axis+"Slider");
  const output = $("offset"+axis+"Out");
  const syncFromField = () => {
    const value = Number(field.value);
    if (!Number.isFinite(value)) return;
    slider.value = String(Math.max(Number(slider.min), Math.min(Number(slider.max), value)));
    output.value = value.toFixed(1) + " mm";
  };
  slider.addEventListener("input", () => {
    field.value = slider.value;
    output.value = Number(slider.value).toFixed(1) + " mm";
    try { drawPreview(); } catch (e) { $("status").textContent = e.message; }
  });
  field.addEventListener("input", syncFromField);
  syncFromField();
}

function thinBinaryImage(binary,width,height){
  const n8=i=>[binary[i-width],binary[i-width+1],binary[i+1],binary[i+width+1],binary[i+width],binary[i+width-1],binary[i-1],binary[i-width-1]];
  let changed=true,passes=0;const remove=[];
  while(changed&&passes++<80){changed=false;
    for(let phase=0;phase<2;phase++){remove.length=0;
      for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
        const i=y*width+x;if(!binary[i])continue;const n=n8(i),count=n.reduce((a,v)=>a+v,0);
        if(count<2||count>6)continue;let transitions=0;
        for(let k=0;k<8;k++)if(!n[k]&&n[(k+1)%8])transitions++;
        if(transitions!==1)continue;const [p2,p3,p4,p5,p6,p7,p8,p9]=n;
        const keep=phase===0?!(p2*p4*p6||p4*p6*p8):!(p2*p4*p8||p2*p6*p8);
        if(keep)remove.push(i);
      }
      if(remove.length){for(const i of remove)binary[i]=0;changed=true;}
    }
  }return binary;
}
function skeletonToPaths(binary,width,height){
  const adj=new Map(),nodes=[];
  for(let i=0;i<binary.length;i++)if(binary[i]){
    nodes.push(i);const x=i%width,y=Math.floor(i/width),a=[];
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(dx||dy){
      const xx=x+dx,yy=y+dy;if(xx>=0&&xx<width&&yy>=0&&yy<height){const j=yy*width+xx;if(binary[j])a.push(j);}
    }adj.set(i,a);
  }
  const used=new Set(),paths=[],key=(a,b)=>a<b?a+","+b:b+","+a;
  const trace=(a,b)=>{const p=[a];let prev=a,cur=b;used.add(key(a,b));p.push(b);
    while(true){const opts=(adj.get(cur)||[]).filter(v=>v!==prev);if(opts.length!==1)break;
      const next=opts[0],k=key(cur,next);if(used.has(k))break;used.add(k);prev=cur;cur=next;p.push(cur);
    }return p;
  };
  for(const i of nodes){const a=adj.get(i)||[];if(a.length===2)continue;for(const j of a)if(!used.has(key(i,j))){const p=trace(i,j);if(p.length>1)paths.push(p);}}
  for(const i of nodes)for(const j of adj.get(i)||[])if(!used.has(key(i,j))){const p=trace(i,j);if(p.length>1)paths.push(p);}
  return paths;
}
function simplifyPath(p,tol=0.7){
  if(p.length<3)return p;const keep=new Uint8Array(p.length);keep[0]=keep[p.length-1]=1;const stack=[[0,p.length-1]],t2=tol*tol;
  while(stack.length){const [a,b]=stack.pop(),u=p[a],v=p[b],dx=v.x-u.x,dy=v.y-u.y,l=dx*dx+dy*dy;let best=t2,at=-1;
    for(let i=a+1;i<b;i++){const q=p[i],t=l?Math.max(0,Math.min(1,((q.x-u.x)*dx+(q.y-u.y)*dy)/l)):0,ex=q.x-u.x-t*dx,ey=q.y-u.y-t*dy,d=ex*ex+ey*ey;if(d>best){best=d;at=i;}}
    if(at>=0){keep[at]=1;stack.push([a,at],[at,b]);}
  }return p.filter((_,i)=>keep[i]);
}
function orderPaths(paths){
  const todo=paths.slice(),out=[];let last=null;
  while(todo.length){let bi=0,rev=false,best=Infinity;
    for(let i=0;i<todo.length;i++){const p=todo[i],a=p[0],b=p[p.length-1],da=last?(a.x-last.x)**2+(a.y-last.y)**2:0,db=last?(b.x-last.x)**2+(b.y-last.y)**2:0;
      if(da<best){best=da;bi=i;rev=false;}if(db<best){best=db;bi=i;rev=true;}
    }let p=todo.splice(bi,1)[0];if(rev)p=p.slice().reverse();out.push(p);last=p[p.length-1];
  }return out;
}
function generateGcode(){
  const s=settings();validate(s);if(!sourceCanvas)throw new Error("Upload a PDF or image first.");
  const ow=sourceCanvas.width,oh=sourceCanvas.height,resize=Math.min(1,1200/Math.max(ow,oh));
  const raster=document.createElement("canvas");raster.width=Math.max(1,Math.round(ow*resize));raster.height=Math.max(1,Math.round(oh*resize));
  const rc=raster.getContext("2d",{willReadFrequently:true});rc.drawImage(sourceCanvas,0,0,raster.width,raster.height);
  const w=raster.width,h=raster.height,data=rc.getImageData(0,0,w,h).data,mask=new Uint8Array(w*h);
  for(let i=0,p=0;i<mask.length;i++,p+=4){const g=Math.round(.299*data[p]+.587*data[p+1]+.114*data[p+2]);mask[i]=s.invert?(g>s.threshold?1:0):(g<=s.threshold?1:0);}
  thinBinaryImage(mask,w,h);
  let paths=orderPaths(skeletonToPaths(mask,w,h).map(a=>simplifyPath(a.map(i=>({x:i%w,y:Math.floor(i/w)})),s.lineSpacing)).filter(p=>p.length>1));
  if(!paths.length)throw new Error("No connected pen paths found. Try changing the darkness threshold or using a clearer image.");
  const uw=s.bedWidth-2*s.margin,uh=s.bedHeight-2*s.margin,scale=Math.min(uw/ow,uh/oh);
  // Image coordinates describe the desired PEN TIP path. The nozzle must move
  // opposite the measured pen-tip offset so the front-mounted pen lands on that path.
  const penX0=s.originX+s.margin+(uw-ow*scale)/2,penY0=s.originY+s.margin+(uh-oh*scale)/2;
  const x0=penX0-s.offsetX,y0=penY0-s.offsetY;
  const px=scale/resize,up=s.penUp+s.offsetZ,down=s.penDown+s.offsetZ;
  const isA1 = s.profile === "bambu-a1";
  const lines = isA1
    ? ["; BAMBU LAB A1 PROFILE — MOTION-ONLY REVIEW EXPORT","; NOT a complete printer job and NOT approved to run directly on an A1.","; Requests homing of all axes at the start of each generated file.","; Verify homing travel and front-mounted holder clearance, including the A1 nozzle-wipe area.","; Verify pen mount offsets, measured Z clearance, bed clips, wiper, cutter, and all keep-outs.","; Initial software envelope is limited to 180 x 180 mm; this is not a physical clearance guarantee.","; Generated by 3D Writer · connected centerline strokes","G28 ; home all axes","G21 ; millimeters","G90 ; absolute positioning","G0 Z"+up.toFixed(3)+" F"+s.zFeed]
    : ["; Connected centerline pen-plotter output","; Generated by 3D Writer · skeletonized strokes","; Check machine limits, offsets, and Z heights before use.","G21 ; millimeters","G90 ; absolute positioning","G0 Z"+up.toFixed(3)+" F"+s.zFeed];
  let count=0,segments=0;
  for(const path of paths){const pts=path.map(p=>({x:x0+ow*scale-p.x*px,y:y0+oh*scale-p.y*px}));
    if(pts.length<2)continue;
    if(pts.some(p=>p.x<0||p.y<0||p.x>256||p.y>256))throw new Error("A drawing path would leave the A1 256 × 256 mm build area. Reduce the image size, margins, or offsets.");
    lines.push("G0 Z"+up.toFixed(3)+" F"+s.zFeed,"G0 X"+pts[0].x.toFixed(3)+" Y"+pts[0].y.toFixed(3)+" F"+s.travelFeed,"G1 Z"+down.toFixed(3)+" F"+s.zFeed);
    for(let i=1;i<pts.length;i++){lines.push("G1 X"+pts[i].x.toFixed(3)+" Y"+pts[i].y.toFixed(3)+" F"+s.drawFeed);segments++;}
    count++;
  }
  if (isA1) {
    lines.push("; End of motion-only review export. No printer shutdown or park commands supplied.");
  } else {
    lines.push("G0 Z"+up.toFixed(3)+" F"+s.zFeed,"M5","M400","; End");
  }
  const text=lines.join("\n")+"\n",blob=new Blob([text],{type:"text/plain;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download=isA1?"A1_motion_only_REVIEW_NOT_READY.txt":"Gcode.txt";document.body.appendChild(a);a.click();a.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  $("strokeCount").textContent=count.toLocaleString()+" connected paths";
  try{setupSimulation(text);$("status").textContent="Downloaded "+a.download+" · "+count.toLocaleString()+" connected paths, "+segments.toLocaleString()+" drawing segments."+(isA1?" · Review-only; not a printer-ready job.":"");}
  catch(e){console.error("3D preview unavailable:",e);$("status").textContent="Downloaded "+a.download+" · "+count.toLocaleString()+" connected paths. 3D preview unavailable."+(isA1?" Review-only; not a printer-ready job.":"");}
}

$("generate").addEventListener("click",()=>{try{generateGcode();}catch(e){$("status").textContent=e.message;}});


// Three.js visual simulator: reads the generated G-code, never controls a real printer.
let sim = null;
let simTimer = null;
function setupSimulation(gcodeText) {
  const moves=[]; let x=0,y=0,z=5,pen=false;
  for (const raw of gcodeText.split(/\r?\n/)) {
    const line=raw.split(";")[0].trim();
    const command=line.match(/^(G0|G1)\s/i);
    if(!command) continue;
    const get=(axis,current)=>{const m=line.match(new RegExp("(?:^|\\s)"+axis+"([-+]?(?:\\d+\\.?\\d*|\\.\\d+))","i"));return m?Number(m[1]):current;};
    const oldX=x,oldY=y;
    x=get("X",x);y=get("Y",y);z=get("Z",z);
    if(command[1].toUpperCase()==="G1" && /(?:^|\s)Z/i.test(line)) pen=true;
    if(command[1].toUpperCase()==="G0" && /(?:^|\s)Z/i.test(line)) pen=false;
    moves.push({x,y,z,draw:pen,fromX:oldX,fromY:oldY});
  }
  if(!moves.length)return;
  init3D();sim.moves=moves;
  $("simSlider").max=String(moves.length-1);$("simSlider").value="0";
  $("simSlider").disabled=false;$("simPlay").disabled=false;
  $("simStatus").textContent=moves.length.toLocaleString()+" moves loaded";
  updateSimulation(0);
}
function init3D(){
  const host=$("simViewport");
  if(sim?.renderer){sim.renderer.setAnimationLoop(null);sim.renderer.dispose();host.removeChild(sim.renderer.domElement);}
  $("simEmpty").style.display="none";
  const scene=new THREE.Scene();scene.background=new THREE.Color(0x0b1626);
  const camera=new THREE.PerspectiveCamera(38,host.clientWidth/430,.1,3000);
  const renderer=new THREE.WebGLRenderer({antialias:true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));renderer.setSize(host.clientWidth,430);host.appendChild(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xd9eaff,0x27364a,2.1));
  const light=new THREE.DirectionalLight(0xffffff,2.2);light.position.set(220,520,300);scene.add(light);
  const mat=(color,roughness=.65)=>new THREE.MeshStandardMaterial({color,roughness});
  const frame=mat(0x9aaabd),dark=mat(0x34465d),baseMat=mat(0x25364b),bedMat=mat(0x34485e);
  const beam=(w,h,d,x,y,z,m,parent=scene)=>{const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);o.position.set(x,y,z);parent.add(o);return o;};
  const line=(points,color=0x62768d)=>{const g=new THREE.BufferGeometry().setFromPoints(points);const o=new THREE.Line(g,new THREE.LineBasicMaterial({color}));scene.add(o);return o;};

  // Dimensional envelope: 465 W × 410 D × 430 H mm.
  // One Three.js world unit equals one millimetre; moving mechanisms are a simplified reconstruction.
  const W=465,D=410,H=430,bedLeft=(W-256)/2,bedFront=77,bedSurfaceY=60.8;
  beam(W,20,D,W/2,10,D/2,baseMat);
  // Feet and side structure.
  for(const x of [24,W-24])for(const z of [22,D-22]){
    beam(46,12,42,x,6,z,dark);
  }
  // Rear support columns and upper cross structure.
  for(const x of [48,W-48]){
    beam(18,370,18,x,215,28,frame);
    beam(18,18,360,x,420,200,frame);
  }
  beam(W-70,18,18,W/2,420,28,frame);
  beam(W-70,18,18,W/2,420,D-28,frame);
  // Rear cross brace and small side details.
  beam(18,18,D-56,48,398,D/2,dark);
  beam(18,18,D-56,W-48,398,D/2,dark);

  // A1-style moving bed: 256 × 256 mm plate translates along the Y travel axis.
  const bedGroup=new THREE.Group();scene.add(bedGroup);
  beam(256,8,256,128,4,128,bedMat,bedGroup);
  beam(250,2,250,128,9,128,mat(0x4c6077),bedGroup);
  const paperMat=mat(0xf3f0e6,.95);
  const paper=new THREE.Mesh(new THREE.BoxGeometry(256,.8,256),paperMat);
  paper.position.set(128,10.4,128);bedGroup.add(paper);
  const paperEdge=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(256,.9,256)),new THREE.LineBasicMaterial({color:0xb8b5aa}));
  paperEdge.position.copy(paper.position);bedGroup.add(paperEdge);
  // Paper clips are illustrative and remain attached to the moving bed.
  for(const [x,z] of [[8,8],[248,8],[8,248],[248,248]]){
    beam(14,3,8,x,12,z,mat(0x8aa6c2),bedGroup);
  }

  // Moving X gantry and toolhead. The pen is fixed beside the nozzle, as on the holder.
  const gantryGroup=new THREE.Group();gantryGroup.position.z=bedFront;scene.add(gantryGroup);
  beam(390,22,20,W/2,0,0,dark,gantryGroup);
  beam(16,34,24,W/2,0,0,frame,gantryGroup);
  const headGroup=new THREE.Group();gantryGroup.add(headGroup);
  // The nozzle tip and pen tip share the same vertical calibration reference at 0 mm.
  beam(48,54,42,0,-42,0,mat(0x9de6c2),headGroup);
  beam(20,42,22,0,-86,0,dark,headGroup);
  const nozzle=new THREE.Mesh(new THREE.CylinderGeometry(5,2.2,108,18),mat(0xc7d1dd));
  nozzle.position.set(0,-145,0);headGroup.add(nozzle);
  const nozzleTip=new THREE.Mesh(new THREE.ConeGeometry(2.4,9,16),mat(0x596779));
  nozzleTip.rotation.z=Math.PI;nozzleTip.position.set(0,-199.5,0);headGroup.add(nozzleTip);
  // Photo-based FRONT-mounted spring pen holder reconstruction.
  // The holder sits in front of the nozzle along the machine's front/back axis.
  // This is a visual approximation, not measured CAD; the installed offset must be calibrated.
  const holderWhite=mat(0xe8e2d8,.82),holderShadow=mat(0xc9c2b8,.82),penBlack=mat(0x171b20,.5),springMetal=mat(0x9ba5ae,.42);
  const holderAssembly=new THREE.Group();
  holderAssembly.position.set(Number($("offsetX").value),0,25+Number($("offsetY").value));
  headGroup.add(holderAssembly);
  const mountX=0;
  // Tall molded holder body beside the nozzle, with a recessed central pen channel.
  beam(39,122,48,mountX,-91,0,holderWhite,holderAssembly);
  beam(25,106,4,mountX,-91,25,holderShadow,holderAssembly);
  beam(7,100,5,mountX-16,-91,27,holderWhite,holderAssembly);
  beam(7,100,5,mountX+16,-91,27,holderWhite,holderAssembly);
  // Upper and lower retaining bridges/clips visible in the reference photo.
  beam(46,13,20,mountX,-48,31,holderWhite,holderAssembly);
  beam(46,13,20,mountX,-139,31,holderWhite,holderAssembly);
  beam(18,8,9,mountX-17,-48,42,holderShadow,holderAssembly);
  beam(18,8,9,mountX+17,-139,42,holderShadow,holderAssembly);
  // Vertical pen barrel and tapered writing tip.
  const pen=new THREE.Mesh(new THREE.CylinderGeometry(4.2,3.4,118,20),penBlack);
  pen.position.set(mountX,-151,0);holderAssembly.add(pen);
  const penCollar=new THREE.Mesh(new THREE.CylinderGeometry(5.2,5.2,8,20),springMetal);
  penCollar.position.set(mountX,-91,0);holderAssembly.add(penCollar);
  const penTip=new THREE.Mesh(new THREE.ConeGeometry(3.1,13,18),penBlack);
  penTip.rotation.z=Math.PI;penTip.position.set(mountX,-216.5,0);holderAssembly.add(penTip);
  // Small visible spring/slider guide behind the pen barrel.
  const guide=new THREE.Mesh(new THREE.CylinderGeometry(2.3,2.3,72,12),springMetal);
  guide.position.set(mountX+11,-91,-27);holderAssembly.add(guide);
  for(let k=0;k<9;k++){
    const ring=new THREE.Mesh(new THREE.TorusGeometry(3.3,.75,6,16),springMetal);
    ring.rotation.x=Math.PI/2;ring.position.set(mountX+11,-58-k*8,-27);holderAssembly.add(ring);
  }

  // Bed-local ink follows the paper while the bed moves under the fixed pen.
  const path=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0x243047}));
  bedGroup.add(path);

  const aim=new THREE.Vector3(W/2,180,D/2),theta=.78,phi=.96;
  let angle=theta,elevation=phi,radius=850,drag=false,lx=0,ly=0;
  const place=()=>{elevation=Math.max(.12,Math.min(1.48,elevation));camera.position.set(aim.x+radius*Math.sin(elevation)*Math.sin(angle),aim.y+radius*Math.cos(elevation),aim.z+radius*Math.sin(elevation)*Math.cos(angle));camera.lookAt(aim);};place();
  renderer.domElement.addEventListener("pointerdown",e=>{drag=true;lx=e.clientX;ly=e.clientY;renderer.domElement.setPointerCapture(e.pointerId);});
  renderer.domElement.addEventListener("pointerup",()=>drag=false);
  renderer.domElement.addEventListener("pointercancel",()=>drag=false);
  renderer.domElement.addEventListener("pointermove",e=>{if(!drag)return;angle-=(e.clientX-lx)*.006;elevation+=(e.clientY-ly)*.006;lx=e.clientX;ly=e.clientY;place();});
  renderer.domElement.addEventListener("wheel",e=>{radius=Math.max(500,Math.min(1500,radius+e.deltaY*.7));place();},{passive:true});
  sim={scene,camera,renderer,bedGroup,gantryGroup,headGroup,holderAssembly,path,moves:[],index:0,bedLeft,bedFront,bedSurfaceY,manualZ:Number($("simPenHeight")?.value||0)};
  bedGroup.position.set(bedLeft,52,bedFront);
  headGroup.position.set(bedLeft+128+25,0,0);
  renderer.setAnimationLoop(()=>renderer.render(scene,camera));
  window.addEventListener("resize",()=>{if(!sim)return;camera.aspect=host.clientWidth/430;camera.updateProjectionMatrix();renderer.setSize(host.clientWidth,430);});
  updatePenHeightControl();
}
function updatePenHeightControl(){
  if(!sim?.gantryGroup)return;
  const value=Number($("simPenHeight").value);
  sim.manualZ=value;
  $("simPenHeightOut").textContent=(value>0?"+":"")+value.toFixed(1)+" mm";
  $("simPenHeightState").textContent=value===0
    ?"0.0 mm · pen tip aligned with nozzle reference"
    :(value>0?"Raised ":"Lowered ")+Math.abs(value).toFixed(1)+" mm from calibration reference";
  const m=sim.moves?.[sim.index];
  const down=number("penDown")+number("offsetZ");
  const gcodeDelta=m?m.z-down:0;
  sim.gantryGroup.position.y=260.8+gcodeDelta+value;
  // The holder is in front of the nozzle (+ machine Y / scene depth).
  // Offset fields describe pen-tip position relative to nozzle; they move the holder.
  if(sim.holderAssembly) sim.holderAssembly.position.set(Number($("offsetX").value),0,25+Number($("offsetY").value));
}
function updateSimulation(index){
  if(!sim?.moves?.length)return;
  sim.index=Math.max(0,Math.min(sim.moves.length-1,Math.floor(index)));
  const s=settings(),m=sim.moves[sim.index];
  const headX=sim.bedLeft+m.x+25;
  // The bed moves in Y; the fixed pen stays over the selected bed-local Y coordinate.
  sim.headGroup.position.set(headX,0,0);
  const down=s.penDown+s.offsetZ;
  sim.gantryGroup.position.y=sim.bedSurfaceY+200+(m.z-down)+sim.manualZ;
  sim.bedGroup.position.set(sim.bedLeft,52,sim.bedFront-m.y);
  const points=[];
  for(let i=0;i<=sim.index;i++){
    const q=sim.moves[i];
    if(q.draw&&(q.x!==q.fromX||q.y!==q.fromY)){
      // Render the actual pen tip path, not the offset nozzle path.
      points.push(new THREE.Vector3(q.fromX+s.offsetX,10.9,q.y+s.offsetY));
      points.push(new THREE.Vector3(q.x+s.offsetX,10.9,q.y+s.offsetY));
    }
  }
  sim.path.geometry.dispose();sim.path.geometry=new THREE.BufferGeometry().setFromPoints(points);
  $("simSlider").value=String(sim.index);
  $("simProgress").textContent=Math.round(sim.index/Math.max(1,sim.moves.length-1)*100)+"%";
  $("simStatus").textContent=(sim.index+1).toLocaleString()+" / "+sim.moves.length.toLocaleString()+" moves";
  updatePenHeightControl();
}
function stopSim(){if(simTimer){clearInterval(simTimer);simTimer=null;} $("simPlay").textContent="▶ Play";}
$("simPlay").addEventListener("click",()=>{
  if(!sim?.moves?.length)return;
  if(simTimer){stopSim();return;}
  if(sim.index>=sim.moves.length-1)updateSimulation(0);
  $("simPlay").textContent="Ⅱ Pause";
  simTimer=setInterval(()=>{const step=Math.max(1,Math.round(Number($("simSpeed").value)));const next=sim.index+step;if(next>=sim.moves.length-1){updateSimulation(sim.moves.length-1);stopSim();}else updateSimulation(next);},45);
});
$("simSlider").addEventListener("input",()=>{stopSim();updateSimulation(Number($("simSlider").value));});
$("simPenHeight").addEventListener("input",()=>{if(sim?.moves?.length)updateSimulation(sim.index);else updatePenHeightControl();});
// Show the A1 model and pen-height control immediately, before a file is generated.
try{init3D();}catch(e){console.warn("3D model could not initialize:",e);$("simStatus").textContent="3D preview unavailable in this browser";}
