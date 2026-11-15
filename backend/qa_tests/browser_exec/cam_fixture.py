"""Synthetic webcam for browser tests (test fixture, not part of the app).
mode 'genuine'  : fixed sensor-noise pattern (seed A) + per-frame noise + 72 bpm pulse on the face.
mode 'injected' : a different noise pattern (seed B), no pulse, looped frames  (stand-in for a replayed/AI video).
"""
import base64, json, mimetypes, os
MP_DIR = "/path/to/DeepVerify/frontend/node_modules/@mediapipe/face_mesh"
_b64 = base64.b64encode(open("/tmp/imgs/face1.jpg","rb").read()).decode()

def init_script(devices):
    """devices: list of dicts {label, mode}; first is default."""
    return """
(() => {
  const DEVICES = %s;
  const IMG = 'data:image/jpeg;base64,%s';
  const W=640,H=480;
  function mulberry(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
  const img = new Image(); const ready = new Promise(r=>{img.onload=r}); img.src = IMG;
  const streams = {};
  async function makeStream(dev){
    await ready;
    const base=document.createElement('canvas'); base.width=W; base.height=H; const bx=base.getContext('2d');
    bx.fillStyle='#778'; bx.fillRect(0,0,W,H); bx.drawImage(img,(W-512)/2,0,512,512);
    const bd=bx.getImageData(0,0,W,H).data;
    const b2=document.createElement('canvas'); b2.width=W; b2.height=H; const b2x=b2.getContext('2d'); b2x.fillStyle='#778'; b2x.fillRect(0,0,W,H);
    b2x.drawImage(img,117,26,220,220,5,80,310,310); b2x.drawImage(img,117,26,220,220,325,80,310,310); const bd2=b2x.getImageData(0,0,W,H).data;
    const rnd=mulberry(dev.mode==='genuine'?12345:98765);
    const prnu=new Float32Array(W*H); for(let i=0;i<prnu.length;i++){prnu[i]=(rnd()-0.5)*0.03;}  // +-5%% fixed pattern
    const cv=document.createElement('canvas'); cv.width=W; cv.height=H; const cx=cv.getContext('2d', {willReadFrequently:true});
    const out=cx.createImageData(W,H); const o=out.data; let f=0; const t0=performance.now();
    // pre-generated noise pool (120 frames ~ 8 s cycle) so per-frame cost stays small and steady
    const NF=120, nrng=mulberry(dev.mode==='genuine'?555:777); const pool=[]; const NPF = dev.mode==='genuine'?NF:45;
    for(let k=0;k<NPF;k++){const a=new Int8Array(W*H); for(let i=0;i<a.length;i++){a[i]=((nrng()-0.5)*3)|0;} pool.push(a);}
    const gain=new Float32Array(W*H); for(let i=0;i<gain.length;i++) gain[i]=1+prnu[i];
    function frame(){
      const t=(performance.now()-t0)/1000; f++;
      const pulse = dev.mode==='genuine' ? 1+0.025*Math.sin(2*Math.PI*1.2*t) : 1;
      const nz=pool[f%%NPF]; const mode=window.__camMode||'normal'; const src = mode==='two'?bd2:bd;
      for(let i=0,p=0;i<W*H;i++,p+=4){
        const g=gain[i], n=nz[i];
        if(mode==='covered'){o[p]=o[p+1]=o[p+2]=6; o[p+3]=255;} else {o[p]=src[p]*g*pulse+n; o[p+1]=src[p+1]*g*pulse+n; o[p+2]=src[p+2]*g*pulse+n; o[p+3]=255;}
      }
      cx.putImageData(out,0,0);
    }
    frame(); setInterval(frame, 66);
    const s=cv.captureStream(15); return s;
  }
  const mdev = navigator.mediaDevices;
  const origEnum = mdev.enumerateDevices.bind(mdev);
  mdev.enumerateDevices = async () => { const real = await origEnum(); const aud = real.filter(d=>d.kind!=='videoinput');
    return DEVICES.map((d,i)=>({deviceId:'dev'+i, kind:'videoinput', label:d.label, groupId:'g'+i, toJSON(){return this}})).concat(aud); };
  const origGUM = mdev.getUserMedia.bind(mdev);
  mdev.getUserMedia = async (c) => {
    let vs=null, as=null;
    if (c && c.video) {
      let idx=0; const want = c.video && c.video.deviceId; const id = want && (want.exact||want.ideal||want);
      if (typeof id==='string' && id.startsWith('dev')) idx=parseInt(id.slice(3));
      const dev=DEVICES[idx]; vs = await makeStream(dev); const tr = vs.getVideoTracks()[0];
      Object.defineProperty(tr,'label',{value:dev.label}); const gs=tr.getSettings.bind(tr);
      tr.getSettings=()=>Object.assign(gs(),{deviceId:'dev'+idx,width:W,height:H,frameRate:15});
    }
    if (c && c.audio) { try { as = await origGUM({audio:true}); } catch(e) {} }
    const ms = new MediaStream(); if(vs) vs.getVideoTracks().forEach(t=>ms.addTrack(t)); if(as) as.getAudioTracks().forEach(t=>ms.addTrack(t)); return ms;
  };
})();
""" % (json.dumps(devices), _b64)

def route_mediapipe(ctx):
    def handler(route):
        url=route.request.url; fn=url.split("/@mediapipe/face_mesh/")[-1].split("?")[0]
        path=os.path.join(MP_DIR, fn)
        if os.path.isfile(path):
            return route.fulfill(path=path, content_type=mimetypes.guess_type(path)[0] or "application/octet-stream", headers={"Access-Control-Allow-Origin":"*"})
        return route.abort()
    ctx.route("**/cdn.jsdelivr.net/npm/@mediapipe/face_mesh/**", handler)

MONACO="/tmp/monaco/node_modules/monaco-editor/min/vs"
def route_monaco(ctx):
    def handler(route):
        fn=route.request.url.split("/min/vs/")[-1].split("?")[0]; path=os.path.join(MONACO, fn)
        if os.path.isfile(path):
            return route.fulfill(path=path, content_type=mimetypes.guess_type(path)[0] or "application/javascript", headers={"Access-Control-Allow-Origin":"*"})
        return route.abort()
    ctx.route("**/cdn.jsdelivr.net/npm/monaco-editor@*/min/vs/**", handler)
def route_all(ctx):
    route_mediapipe(ctx); route_monaco(ctx)
