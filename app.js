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
  travelFeed: number("travelFeed"), drawFeed: number("drawFeed"), zFeed: number("zFeed")
});
function validate(s) {
  if (s.bedWidth <= 0 || s.bedHeight <= 0 || s.margin < 0 || s.bedWidth <= 2*s.margin || s.bedHeight <= 2*s.margin) throw new Error("Bed size must be positive and larger than twice the margin.");
  if (s.lineSpacing <= 0 || s.travelFeed <= 0 || s.drawFeed <= 0 || s.zFeed <= 0) throw new Error("Line spacing and feed rates must be greater than zero.");
  if (s.threshold < 0 || s.threshold > 255) throw new Error("Threshold must be between 0 and 255.");
}
function drawPreview() {
  if (!sourceCanvas) return;
  const s = settings(); validate(s);
  const w = sourceCanvas.width, h = sourceCanvas.height;
  const data = sourceCanvas.getContext("2d", {willReadFrequently:true}).getImageData(0,0,w,h).data;
  const out = ctx.createImageData(w,h);
  let count = 0;
  for (let i=0;i<data.length;i+=4) {
    const gray = Math.round(.299*data[i]+.587*data[i+1]+.114*data[i+2]);
    const ink = gray < 255;
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

function generateGcode() {
  const s=settings(); validate(s);
  if(!sourceCanvas) throw new Error("Upload a PDF or image first.");
  const w=sourceCanvas.width,h=sourceCanvas.height;
  const usableW=s.bedWidth-2*s.margin, usableH=s.bedHeight-2*s.margin;
  const scale=Math.min(usableW/w,usableH/h);
  const x0=s.originX+s.margin+(usableW-w*scale)/2+s.offsetX;
  const y0=s.originY+s.margin+(usableH-h*scale)/2+s.offsetY;
  const rowStep=Math.max(1,Math.round(s.lineSpacing/scale));
  const pixels=sourceCanvas.getContext("2d",{willReadFrequently:true}).getImageData(0,0,w,h).data;
  const penUpZ=s.penUp+s.offsetZ, penDownZ=s.penDown+s.offsetZ;
  const lines=["; PDF raster pen plotter output","; Generated by 3D Writer","; Verify machine limits, pen offsets, and Z heights before use.","G21 ; millimeters","G90 ; absolute positioning",`G0 Z${penUpZ.toFixed(3)} F${s.zFeed}`];
  let strokes=0;
  for(let row=0,y=0;y<h;row++,y+=rowStep) {
    const runs=[];
    let x=0;
    while(x<w) {
      const idx=(y*w+x)*4;
      const gray=Math.round(.299*pixels[idx]+.587*pixels[idx+1]+.114*pixels[idx+2]);
      const ink=gray<255;
      if(!ink){x++;continue;}
      const start=x;
      while(x+1<w) {
        const j=(y*w+x+1)*4;
        const g=Math.round(.299*pixels[j]+.587*pixels[j+1]+.114*pixels[j+2]);
        if(g===255) break;
        x++;
      }
      runs.push([start,x]); x++;
    }
    if(row%2) runs.reverse();
    const ymm=y0+(h-1-y)*scale;
    for(let [a,b] of runs) {
      let xa=x0+a*scale, xb=x0+b*scale;
      if(row%2) [xa,xb]=[xb,xa];
      lines.push(`G0 Z${penUpZ.toFixed(3)} F${s.zFeed}`);
      lines.push(`G0 X${xa.toFixed(3)} Y${ymm.toFixed(3)} F${s.travelFeed}`);
      lines.push(`G1 Z${penDownZ.toFixed(3)} F${s.zFeed}`);
      lines.push(`G1 X${xb.toFixed(3)} Y${ymm.toFixed(3)} F${s.drawFeed}`);
      strokes++;
    }
  }
  if (strokes === 0) {
    throw new Error("No pen strokes were detected. Make sure the image contains pixels darker than pure white.");
  }
  lines.push(`G0 Z${penUpZ.toFixed(3)} F${s.zFeed}`,"M5","M400","; End");
  const gcodeText=lines.join("\n")+"\n";

  // Download is the primary action. A 3D/WebGL preview failure must never block G-code export.
  const blob=new Blob([gcodeText],{type:"text/plain;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const link=document.createElement("a");
  link.href=url;
  link.download="Gcode.txt";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(()=>URL.revokeObjectURL(url),1000);

  $("strokeCount").textContent=strokes.toLocaleString()+" strokes";
  try {
    setupSimulation(gcodeText);
    $("status").textContent=`Downloaded Gcode.txt · ${strokes.toLocaleString()} pen strokes.`;
  } catch (simulationError) {
    console.error("3D preview could not be initialized:", simulationError);
    $("status").textContent=`Downloaded Gcode.txt · ${strokes.toLocaleString()} pen strokes. 3D preview unavailable in this browser.`;
  }
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
  scene.add(new THREE.GridHelper(240,24,0x52708c,0x263b54));
  const camera=new THREE.PerspectiveCamera(42,host.clientWidth/430,.1,1500);
  camera.position.set(300,260,330);
  const renderer=new THREE.WebGLRenderer({antialias:true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));renderer.setSize(host.clientWidth,430);host.appendChild(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xc9e5ff,0x263348,2));
  const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(160,280,180);scene.add(light);
  const material=(color)=>new THREE.MeshStandardMaterial({color,roughness:.65});
  const frame=material(0x9aaabd),dark=material(0x34465d),bedMat=material(0x26384e);
  const beam=(w,h,d,x,y,z,mat)=>{const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);o.position.set(x,y,z);scene.add(o);return o;};
  // Printer bed and a clearly visible sheet of paper sitting on top.
  beam(230,5,230,110,0,110,bedMat);
  const paperMat=new THREE.MeshStandardMaterial({color:0xf3f0e6,roughness:.92,side:THREE.DoubleSide});
  const paper=new THREE.Mesh(new THREE.BoxGeometry(200,1.2,200),paperMat);
  paper.position.set(110,3.6,110);scene.add(paper);
  const paperEdge=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(200,1.25,200)),new THREE.LineBasicMaterial({color:0xb8b5aa}));
  paperEdge.position.copy(paper.position);scene.add(paperEdge);
  for(const p of [[-8,-8],[228,-8],[-8,228],[228,228]])beam(7,185,7,p[0],92,p[1],frame);
  beam(245,7,7,110,185,-8,frame);beam(245,7,7,110,185,228,frame);
  beam(7,7,245,-8,185,110,frame);beam(7,7,245,228,185,110,frame);
  const carriage=beam(34,24,28,10,145,10,material(0x9de6c2));
  // Pen holder, long pen barrel, collar, and fine writing tip.
  const holder=beam(13,24,13,10,127,10,dark);
  const pen=new THREE.Mesh(new THREE.CylinderGeometry(4.2,3.2,105,18),material(0xe9d7a4));scene.add(pen);
  const penBand=new THREE.Mesh(new THREE.CylinderGeometry(4.8,4.8,5,18),material(0x34465d));scene.add(penBand);
  const tip=new THREE.Mesh(new THREE.ConeGeometry(2.1,9,14),material(0x253044));tip.rotation.z=Math.PI;scene.add(tip);
  const path=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0x243047}));scene.add(path);
  const aim=new THREE.Vector3(110,20,110);let theta=.8,phi=1.0,radius=470,drag=false,lx=0,ly=0;
  const place=()=>{phi=Math.max(.15,Math.min(1.5,phi));camera.position.set(aim.x+radius*Math.sin(phi)*Math.sin(theta),aim.y+radius*Math.cos(phi),aim.z+radius*Math.sin(phi)*Math.cos(theta));camera.lookAt(aim);};place();
  renderer.domElement.addEventListener("pointerdown",e=>{drag=true;lx=e.clientX;ly=e.clientY;renderer.domElement.setPointerCapture(e.pointerId);});
  renderer.domElement.addEventListener("pointerup",()=>drag=false);
  renderer.domElement.addEventListener("pointermove",e=>{if(!drag)return;theta-=(e.clientX-lx)*.008;phi+=(e.clientY-ly)*.008;lx=e.clientX;ly=e.clientY;place();});
  renderer.domElement.addEventListener("wheel",e=>{radius=Math.max(260,Math.min(850,radius+e.deltaY*.5));place();},{passive:true});
  sim={scene,camera,renderer,carriage,holder,pen,penBand,tip,path,moves:[],index:0};
  renderer.setAnimationLoop(()=>renderer.render(scene,camera));
  window.addEventListener("resize",()=>{if(!sim)return;camera.aspect=host.clientWidth/430;camera.updateProjectionMatrix();renderer.setSize(host.clientWidth,430);});
}
function updateSimulation(index){
  if(!sim?.moves?.length)return;
  sim.index=Math.max(0,Math.min(sim.moves.length-1,Math.floor(index)));
  const s=settings(),m=sim.moves[sim.index];
  const usableW=s.bedWidth-2*s.margin,usableH=s.bedHeight-2*s.margin;
  const scale=Math.min(200/Math.max(1,usableW),200/Math.max(1,usableH));
  // Map machine coordinates onto the 200 × 200 mm sheet, including the configured margin.
  const px=(m.x-s.originX-s.margin)*scale+10,pz=(m.y-s.originY-s.margin)*scale+10;
  // Pen tip tracks the commanded Z height; at pen-down it touches the paper surface.
  const paperSurfaceY=4.35;
  const py=paperSurfaceY+(m.z-(s.penDown+s.offsetZ))*scale;
  sim.carriage.position.set(px,145,pz);
  sim.holder.position.set(px,127,pz);
  sim.pen.position.set(px,py+52.5,pz);
  sim.penBand.position.set(px,py+89,pz);
  sim.tip.position.set(px,py+4.5,pz);
  const points=[];
  for(let i=0;i<=sim.index;i++){
    const q=sim.moves[i];
    if(q.draw && (q.x!==q.fromX || q.y!==q.fromY)){
      points.push(new THREE.Vector3((q.fromX-s.originX-s.margin)*scale+10,paperSurfaceY+0.15,(q.fromY-s.originY-s.margin)*scale+10));
      points.push(new THREE.Vector3((q.x-s.originX-s.margin)*scale+10,paperSurfaceY+0.15,(q.y-s.originY-s.margin)*scale+10));
    }
  }
  sim.path.geometry.dispose();sim.path.geometry=new THREE.BufferGeometry().setFromPoints(points);
  $("simSlider").value=String(sim.index);
  $("simProgress").textContent=Math.round(sim.index/Math.max(1,sim.moves.length-1)*100)+"%";
  $("simStatus").textContent=(sim.index+1).toLocaleString()+" / "+sim.moves.length.toLocaleString()+" moves";
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
