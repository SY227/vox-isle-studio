/** Original, self-contained WebGL2 character renderer.
 * Shared meshes, pooled GPU buffers, rim-lit materials, bounded DPR, visibility
 * throttling, reduced-motion support, and SVG fallback. No downloaded model assets.
 * The glowing zones are teaching metaphors, NOT physiological measurements.
 */
const vertex=`#version 300 es
precision highp float;
in vec3 aPosition;in vec3 aNormal;
uniform mat4 uVP;uniform vec3 uPosition,uScale,uRotation;uniform float uYaw;
out vec3 vNormal,vWorld;
mat3 rx(float a){float c=cos(a),s=sin(a);return mat3(1,0,0,0,c,s,0,-s,c);}
mat3 ry(float a){float c=cos(a),s=sin(a);return mat3(c,0,-s,0,1,0,s,0,c);}
mat3 rz(float a){float c=cos(a),s=sin(a);return mat3(c,s,0,-s,c,0,0,0,1);}
void main(){mat3 r=rz(uRotation.z)*ry(uRotation.y)*rx(uRotation.x);mat3 g=ry(uYaw);vec3 world=g*(r*(aPosition*uScale)+uPosition);vWorld=world;vNormal=normalize(g*r*(aNormal/uScale));gl_Position=uVP*vec4(world,1);}`;
const fragment=`#version 300 es
precision highp float;
in vec3 vNormal,vWorld;uniform vec4 uColor;uniform vec3 uCamera;uniform float uMetal,uGlow;
out vec4 outColor;
void main(){vec3 n=normalize(vNormal),v=normalize(uCamera-vWorld);vec3 key=normalize(vec3(-.7,1.2,1.5));vec3 fill=normalize(vec3(.8,.2,.7));float diffuse=max(dot(n,key),0.);float fresnel=pow(1.-max(dot(n,v),0.),3.);float spec=pow(max(dot(n,normalize(key+v)),0.),mix(24.,95.,uMetal));float bounce=max(dot(n,fill),0.)*.19;
vec3 color=uColor.rgb*(.25+diffuse*.77+bounce)+vec3(.75,.95,.9)*spec*mix(.23,.65,uMetal)+vec3(.42,.9,.82)*fresnel*.22+uColor.rgb*uGlow;
color=color/(color+vec3(.28));color=pow(color,vec3(.92));outColor=vec4(color,uColor.a);}`;
const normalize=a=>{const l=Math.hypot(...a);return a.map(x=>x/l);};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a,b)=>a.reduce((n,x,i)=>n+x*b[i],0);
function viewProjection(aspect){
  const eye=[0,.38,3.5],target=[0,.17,0],z=normalize(eye.map((a,i)=>a-target[i])),x=normalize(cross([0,1,0],z)),y=cross(z,x);
  const view=[x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,eye),-dot(y,eye),-dot(z,eye),1];
  const f=1/Math.tan(34*Math.PI/360),n=.1,far=20,p=[f/aspect,0,0,0,0,f,0,0,0,0,(far+n)/(n-far),-1,0,0,2*far*n/(n-far),0],out=new Float32Array(16);
  for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)out[c*4+r]+=p[k*4+r]*view[c*4+k];return out;
}
function sphere(){const p=[],n=[],indices=[],lat=24,lon=32;for(let y=0;y<=lat;y++)for(let x=0;x<=lon;x++){const a=y/lat*Math.PI,b=x/lon*Math.PI*2,v=[Math.sin(a)*Math.cos(b),Math.cos(a),Math.sin(a)*Math.sin(b)];p.push(...v);n.push(...v);}for(let y=0;y<lat;y++)for(let x=0;x<lon;x++){const i=y*(lon+1)+x;indices.push(i,i+1,i+lon+1,i+1,i+lon+2,i+lon+1);}return {p,n,indices};}
function torus(arc=Math.PI*2){const p=[],n=[],indices=[],len=80,tube=12;for(let a=0;a<=len;a++)for(let b=0;b<=tube;b++){const u=a/len*arc,v=b/tube*Math.PI*2,r=1+.065*Math.cos(v);p.push(r*Math.cos(u),r*Math.sin(u),.065*Math.sin(v));n.push(Math.cos(v)*Math.cos(u),Math.cos(v)*Math.sin(u),Math.sin(v));}for(let a=0;a<len;a++)for(let b=0;b<tube;b++){const i=a*(tube+1)+b;indices.push(i,i+tube+1,i+1,i+1,i+tube+1,i+tube+2);}return {p,n,indices};}
function cone(){const p=[],n=[],indices=[],steps=32;for(let i=0;i<=steps;i++){const a=i/steps*Math.PI*2;for(const [r,y] of [[1,-1],[.045,1]]){p.push(r*Math.cos(a),y,r*Math.sin(a));n.push(Math.cos(a)*.9,.4,Math.sin(a)*.9);}}for(let i=0;i<steps;i++){const j=i*2;indices.push(j,j+2,j+1,j+1,j+2,j+3);}return {p,n,indices};}
function rgba(hex,alpha=1){const h=hex.replace('#','');return [parseInt(h.slice(0,2),16)/255,parseInt(h.slice(2,4),16)/255,parseInt(h.slice(4,6),16)/255,alpha];}
export const fallback=`<svg class="avatar-fallback" viewBox="0 0 320 360" aria-label="聲音練習動畫"><defs><linearGradient id="ceramic" x2="1" y2="1"><stop stop-color="#fbf5e7"/><stop offset="1" stop-color="#9dbcb6"/></linearGradient><radialGradient id="halo"><stop stop-color="#b6efdc" stop-opacity=".22"/><stop offset="1" stop-color="#b6efdc" stop-opacity="0"/></radialGradient></defs><circle cx="160" cy="170" r="150" fill="url(#halo)"/><ellipse cx="160" cy="320" rx="84" ry="11" fill="#b6efdc" opacity=".15"/><g class="float-figure"><path d="M104 92 95 36 137 68M180 68l42-32-9 56" fill="url(#ceramic)"/><ellipse cx="160" cy="126" rx="73" ry="66" fill="url(#ceramic)"/><rect x="110" y="105" width="100" height="51" rx="25" fill="#172e34"/><path d="M132 127v9m56-9v9" stroke="#cdf9e9" stroke-width="9" stroke-linecap="round"/><path d="M151 143q9 7 18 0" fill="none" stroke="#cdf9e9" stroke-width="3"/><ellipse cx="160" cy="229" rx="53" ry="55" fill="url(#ceramic)"/><ellipse cx="96" cy="223" rx="15" ry="33" fill="url(#ceramic)" transform="rotate(18 96 223)"/><ellipse cx="222" cy="206" rx="15" ry="33" fill="url(#ceramic)" transform="rotate(-35 222 206)"/><circle cx="160" cy="220" r="13" fill="#a8e4cf"/><path d="M83 127a77 77 0 0 1 154 0" fill="none" stroke="#d5b597" stroke-width="9"/><rect x="77" y="116" width="20" height="35" rx="10" fill="#253f43"/><rect x="222" y="116" width="20" height="35" rx="10" fill="#253f43"/></g></svg>`;
export class Avatar {
  constructor(mount){
    this.mount=mount;this.state={technique:'mix',playing:false,level:0,speaking:false};this.visible=true;this.destroyed=false;this.motion=matchMedia('(prefers-reduced-motion: reduce)');
    this.canvas=document.createElement('canvas');this.canvas.setAttribute('role','img');this.canvas.setAttribute('aria-label','會隨教學與聲音活動變化的三維聲音練習動畫');mount.replaceChildren(this.canvas);
    try{this.init();mount.dataset.renderer='webgl2';}catch(error){console.warn('Singing Fox avatar fallback:',error.message);mount.innerHTML=fallback;mount.dataset.renderer='svg-fallback';return;}
    this.resize=new ResizeObserver(()=>this.size());this.resize.observe(mount);this.size();
    this.intersection=new IntersectionObserver(entries=>{this.visible=entries[0].isIntersecting;});this.intersection.observe(mount);
    this.start=performance.now();this.last=0;this.frame=this.frame.bind(this);this.frame();
  }
  init(){
    const gl=this.canvas.getContext('webgl2',{alpha:true,antialias:true,powerPreference:'low-power',premultipliedAlpha:false});if(!gl)throw new Error('No WebGL2');this.gl=gl;
    const compile=(type,source)=>{const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader));return shader;};
    const vs=compile(gl.VERTEX_SHADER,vertex),fs=compile(gl.FRAGMENT_SHADER,fragment);this.program=gl.createProgram();gl.attachShader(this.program,vs);gl.attachShader(this.program,fs);gl.linkProgram(this.program);gl.deleteShader(vs);gl.deleteShader(fs);if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw new Error('Shader link failure');gl.useProgram(this.program);
    this.u={};for(const name of ['VP','Position','Scale','Rotation','Yaw','Camera','Color','Metal','Glow'])this.u[name]=gl.getUniformLocation(this.program,'u'+name);
    this.meshes={};for(const [name,geo] of Object.entries({sphere:sphere(),ring:torus(),band:torus(Math.PI),cone:cone()})){
      const vao=gl.createVertexArray();gl.bindVertexArray(vao);const buffers=[];
      for(const [key,attr] of [['p','aPosition'],['n','aNormal']]){const b=gl.createBuffer();buffers.push(b);gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(geo[key]),gl.STATIC_DRAW);const loc=gl.getAttribLocation(this.program,attr);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,3,gl.FLOAT,false,0,0);}
      const index=gl.createBuffer();buffers.push(index);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,index);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(geo.indices),gl.STATIC_DRAW);this.meshes[name]={vao,buffers,count:geo.indices.length};
    }
    gl.enable(gl.DEPTH_TEST);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.clearColor(0,0,0,0);
    this.canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();this.destroyed=true;cancelAnimationFrame(this.raf);this.mount.innerHTML=fallback;this.mount.dataset.renderer='svg-fallback';});
  }
  size(){const r=this.mount.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,1.65);this.canvas.width=Math.max(1,Math.round(r.width*dpr));this.canvas.height=Math.max(1,Math.round(r.height*dpr));this.gl.viewport(0,0,this.canvas.width,this.canvas.height);this.vp=viewProjection(r.width/Math.max(1,r.height));}
  setState(next){Object.assign(this.state,next);this.mount.dataset.mode=this.state.technique;}
  mesh(name,pos,scale,color,rotation=[0,0,0],metal=.2,glow=0,alpha=1){const gl=this.gl,u=this.u,m=this.meshes[name];gl.uniform3fv(u.Position,pos);gl.uniform3fv(u.Scale,scale);gl.uniform3fv(u.Rotation,rotation);gl.uniform4fv(u.Color,rgba(color,alpha));gl.uniform1f(u.Metal,metal);gl.uniform1f(u.Glow,glow);gl.bindVertexArray(m.vao);gl.drawElements(gl.TRIANGLES,m.count,gl.UNSIGNED_SHORT,0);}
  frame(now=performance.now()){
    if(this.destroyed)return;this.raf=requestAnimationFrame(this.frame);if(!this.visible||document.hidden||now-this.last<1000/(this.motion.matches?8:40))return;this.last=now;
    const gl=this.gl,t=this.motion.matches?0:(now-this.start)/1000,bob=Math.sin(t*1.8)*.025,activity=this.state.playing||this.state.speaking?1:0;
    const color={chest:'#efbc9b',mix:'#99e8c8',head:'#b7a7f0',falsetto:'#9edbf2',unknown:'#9fbac1'}[this.state.technique]||'#99e8c8';
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(this.program);gl.uniformMatrix4fv(this.u.VP,false,this.vp);gl.uniform3fv(this.u.Camera,[0,.38,3.5]);gl.uniform1f(this.u.Yaw,Math.sin(t*.48)*.08);
    const draw=(name,p,s,c,r,m,g,a)=>this.mesh(name,[p[0],p[1]+bob,p[2]],s,c,r,m,g,a);
    // Stage: layered metallic rings and a soft luminous island.
    this.mesh('sphere',[0,-.83,-.02],[.77,.035,.43],'#17383a',[0,0,0],.85);
    this.mesh('ring',[0,-.815,-.02],[.7,.42,.5],color,[Math.PI/2,0,0],.8,.15,.65);
    // Ceramic explorer, floating just above the stage.
    draw('sphere',[0,-.19,0],[.34,.41,.25],'#d5dcd0',[0,0,-.02],.45);
    draw('sphere',[0,-.4,-.015],[.31,.16,.23],'#253e42',[0,0,0],.55);
    draw('sphere',[-.17,-.56,.055],[.15,.11,.21],'#d5dcd0',[0,.1,-.06],.45);
    draw('sphere',[.17,-.56,.055],[.15,.11,.21],'#d5dcd0',[0,-.1,.06],.45);
    const wave=Math.sin(t*2.3)*(.025+activity*.12);
    draw('sphere',[-.41,-.12,.025],[.115,.255,.12],'#d2ddd3',[0,0,-.34],.4);
    draw('sphere',[-.49,-.32,.065],[.115,.125,.12],'#e3e8dc',[0,0,-.25],.3);
    draw('sphere',[.43,-.04,.035],[.12,.24,.12],'#d2ddd3',[0,0,.65+wave],.4);
    draw('sphere',[.58,.13+wave*.1,.05],[.12,.13,.115],'#e3e8dc',[0,0,-.1+wave],.35);
    draw('sphere',[.62,.24+wave*.1,.035],[.035,.07,.035],'#e3e8dc',[0,0,-.28+wave],.35);
    // Head, ears, padded headphones and soft LED face.
    draw('sphere',[0,.43,0],[.43,.38,.34],'#e3e6d8',[0,0,0],.5);
    draw('cone',[-.28,.81,-.015],[.115,.22,.105],'#dce2d5',[0,0,.24],.4);
    draw('cone',[.28,.81,-.015],[.115,.22,.105],'#dce2d5',[0,0,-.24],.4);
    draw('cone',[-.285,.83,.06],[.06,.13,.03],'#dbb192',[0,0,.24],.25);
    draw('cone',[.285,.83,.06],[.06,.13,.03],'#dbb192',[0,0,-.24],.25);
    draw('sphere',[0,.425,.259],[.324,.19,.13],'#102b31',[0,0,0],.75);
    draw('band',[0,.48,-.02],[.48,.4,.9],'#acb7a6',[0,0,0],.8);
    for(const x of [-.435,.435]){draw('sphere',[x,.445,-.01],[.075,.155,.2],'#1c373a',[0,0,0],.85);draw('sphere',[x+(x>0?.037:-.037),.445,.035],[.052,.105,.12],color,[0,0,0],.6,.05);}
    const blink=(t%5.7>5.53)? .012:.045;
    for(const x of [-.123,.123]){draw('sphere',[x,.449,.378],[.032,blink,.016],'#bdf6e0',[0,0,x<0?-.1:.1],.2,.4);draw('sphere',[x-.008,.462,.39],[.009,blink*.25,.005],'#ffffff',[0,0,0],.1,.6);}
    for(let i=0;i<9;i++){const x=(i-4)*.012;draw('sphere',[x,.351+.018*(x/.048)**2,.39],[.009,this.state.speaking?.012+.005*Math.sin(t*8):.007,.008],'#a8e9d1',[0,0,0],.2,.25);}
    // Chest signal: illustrative only, driven by audio level / chosen technique.
    draw('sphere',[0,-.115,.243],[.094,.1,.035],'#355852',[0,0,0],.8);
    const pulse=1+Math.sin(t*2.8)*.08+Math.min(this.state.level||0,.3);
    draw('sphere',[0,-.11,.274],[.055*pulse,.058*pulse,.012],color,[0,0,0],.45,.35+activity*.15);
    // Fine orbital rings behind the character, not anatomy markers.
    gl.depthMask(false);
    draw('ring',[0,.33,-.43],[.72,.72,.6],color,[.08,.05,Math.sin(t*.2)*.15],.5,.15,.19);
    draw('ring',[0,-.24,-.03],[.55,.25,.7],color,[Math.PI/2+.08,0,t*.08],.5,.2,.13);
    for(let i=0;i<5;i++){const angle=t*.25+i*1.257;draw('sphere',[Math.cos(angle)*.77,.28+Math.sin(angle)*.66,-.25],[.016,.016,.016],color,[0,0,0],.2,.5,.55);}
    gl.depthMask(true);
  }
  dispose(){this.destroyed=true;cancelAnimationFrame(this.raf);this.resize?.disconnect();this.intersection?.disconnect();if(this.gl){for(const m of Object.values(this.meshes||{})){for(const b of m.buffers)this.gl.deleteBuffer(b);this.gl.deleteVertexArray(m.vao);}this.gl.deleteProgram(this.program);}}
}
