import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";
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
  offsetX: number("offsetX"), offsetY: number("offsetY"), penUp: number("penUp"), penDown: number("penDown"),
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
    const pageNo = number("page");
    if (!Number.isInteger(pageNo) || pageNo < 1 || pageNo > pdfDoc.numPages) throw new Error("Page number is outside this PDF.");
    const page = await pdfDoc.getPage(pageNo);
    const dpi = Math.min(300, Math.max(30, number("dpi")));
    const viewport = page.getViewport({scale:dpi/72});
    if (viewport.width*viewport.height > 20000000) throw new Error("Rendered page is too large. Try a lower DPI.");
    const tmp = document.createElement("canvas");
    tmp.width=Math.ceil(viewport.width); tmp.height=Math.ceil(viewport.height);
    await page.render({canvas:tmp,viewport}).promise;
    sourceCanvas=tmp;
    canvas.width=tmp.width; canvas.height=tmp.height;
    $("pageInfo").textContent = "Page "+pageNo+" of "+pdfDoc.numPages;
    drawPreview();
    $("status").textContent="PDF page ready. Adjust settings and generate your file.";
  } catch(e) { $("status").textContent=e.message; }
  finally { renderBusy=false; }
}
$("pdfFile").addEventListener("change", async (event) => {
  const file=event.target.files?.[0]; if(!file) return;
  if(file.type!=="application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) { $("status").textContent="Please choose a PDF file."; return; }
  try {
    const bytes=await file.arrayBuffer();
    pdfDoc=await pdfjsLib.getDocument({data:bytes}).promise;
    $("fileLabel").textContent=file.name;
    $("generate").disabled=false;
    await loadPage();
  } catch(e) { $("status").textContent="Could not read PDF: "+e.message; }
});
$("page").addEventListener("change",loadPage);
$("dpi").addEventListener("change",loadPage);
$("threshold").addEventListener("input",()=>{ $("thresholdOut").value=$("threshold").value; try{drawPreview();}catch(e){$("status").textContent=e.message;} });
$("invert").addEventListener("change",()=>{try{drawPreview();}catch(e){$("status").textContent=e.message;}});
for(const id of ["bedWidth","bedHeight","margin","lineSpacing","originX","originY","offsetX","offsetY","penUp","penDown","travelFeed","drawFeed","zFeed"]) $(id).addEventListener("change",()=>{try{drawPreview();}catch(e){$("status").textContent=e.message;}});

function generateGcode() {
  const s=settings(); validate(s);
  if(!sourceCanvas) throw new Error("Upload a PDF first.");
  const w=sourceCanvas.width,h=sourceCanvas.height;
  const usableW=s.bedWidth-2*s.margin, usableH=s.bedHeight-2*s.margin;
  const scale=Math.min(usableW/w,usableH/h);
  const x0=s.originX+s.margin+(usableW-w*scale)/2+s.offsetX;
  const y0=s.originY+s.margin+(usableH-h*scale)/2+s.offsetY;
  const rowStep=Math.max(1,Math.round(s.lineSpacing/scale));
  const pixels=sourceCanvas.getContext("2d",{willReadFrequently:true}).getImageData(0,0,w,h).data;
  const lines=["; PDF raster pen plotter output","; Generated by 3D Writer","; Verify machine limits, pen offsets, and Z heights before use.","G21 ; millimeters","G90 ; absolute positioning",`G0 Z${s.penUp.toFixed(3)} F${s.zFeed}`];
  let strokes=0;
  for(let row=0,y=0;y<h;row++,y+=rowStep) {
    const runs=[];
    let x=0;
    while(x<w) {
      const idx=(y*w+x)*4;
      const gray=Math.round(.299*pixels[idx]+.587*pixels[idx+1]+.114*pixels[idx+2]);
      const ink=s.invert?gray>s.threshold:gray<=s.threshold;
      if(!ink){x++;continue;}
      const start=x;
      while(x+1<w) {
        const j=(y*w+x+1)*4;
        const g=Math.round(.299*pixels[j]+.587*pixels[j+1]+.114*pixels[j+2]);
        if(!(s.invert?g>s.threshold:g<=s.threshold)) break;
        x++;
      }
      runs.push([start,x]); x++;
    }
    if(row%2) runs.reverse();
    const ymm=y0+(h-1-y)*scale;
    for(let [a,b] of runs) {
      let xa=x0+a*scale, xb=x0+b*scale;
      if(row%2) [xa,xb]=[xb,xa];
      lines.push(`G0 Z${s.penUp.toFixed(3)} F${s.zFeed}`);
      lines.push(`G0 X${xa.toFixed(3)} Y${ymm.toFixed(3)} F${s.travelFeed}`);
      lines.push(`G1 Z${s.penDown.toFixed(3)} F${s.zFeed}`);
      lines.push(`G1 X${xb.toFixed(3)} Y${ymm.toFixed(3)} F${s.drawFeed}`);
      strokes++;
    }
  }
  lines.push(`G0 Z${s.penUp.toFixed(3)} F${s.zFeed}`,"M5","M400","; End");
  const blob=new Blob([lines.join("\n")+"\n"],{type:"text/plain;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");a.href=url;a.download="Gcode.txt";a.click();URL.revokeObjectURL(url);
  $("status").textContent=`Downloaded Gcode.txt · ${strokes.toLocaleString()} pen strokes.`;
  $("strokeCount").textContent=strokes.toLocaleString()+" strokes";
}
$("generate").addEventListener("click",()=>{try{generateGcode();}catch(e){$("status").textContent=e.message;}});
