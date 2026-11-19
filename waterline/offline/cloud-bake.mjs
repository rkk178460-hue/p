import fs from 'node:fs/promises';
import * as THREE from 'three/webgpu';
import { azimuth, elevation, projectAngle, inverseProjectionWGSL, wgslAxis } from './sky-projection.mjs';

const WORLD = 24000, BASE = 1250, TOP = 3350;
const common = /* wgsl */`
const WORLD: f32 = 24000.0;
const BASE: f32 = 1250.0;
const TOP: f32 = 3350.0;
fn hash3(p: vec3<f32>) -> vec3<f32> {
  var q = fract(p * vec3<f32>(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yxz + vec3<f32>(33.33));
  return fract((q.xxy + q.yxx) * q.zyx);
}
fn noise(p: vec3<f32>, period: f32) -> f32 {
  let c = floor(p); let f = fract(p);
  let w = f*f*f*(f*(f*6.0-15.0)+10.0);
  var v = 0.0;
  for(var z=0; z<2; z++) { for(var y=0; y<2; y++) { for(var x=0; x<2; x++) {
    let d=vec3<f32>(f32(x),f32(y),f32(z));
    var cell = c+d;
    cell -= floor(cell/period)*period;
    let weight = mix(vec3<f32>(1.0)-w,w,d);
    v += hash3(cell).x*weight.x*weight.y*weight.z;
  } } }
  return v;
}
fn worley(p: vec3<f32>, period: f32) -> f32 {
  let c=floor(p);let f=fract(p); var nearest=3.0;
  for(var z=-1;z<=1;z++){for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
    let offset=vec3<f32>(f32(x),f32(y),f32(z));
    var cell=c+offset;
    cell-=floor(cell/period)*period;
    let delta=offset+hash3(cell)-f;
    nearest=min(nearest,dot(delta,delta));
  }}}
  return clamp(sqrt(nearest),0.0,1.0);
}
fn cloudUV(p:vec3<f32>)->vec3<f32>{
  return vec3<f32>(fract(p.x/WORLD+0.5),clamp((p.y-BASE)/(TOP-BASE),0.0,1.0),fract(p.z/WORLD+0.5));
}
fn clearSky(ray:vec3<f32>, sun:vec3<f32>, sunColor:vec3<f32>, light:vec3<f32>)->vec3<f32>{
  let y=max(ray.y,0.0);
  let towardSun=clamp(dot(ray,sun),0.0,1.0);
  let haze=exp(-y*7.5);
  let night=mix(vec3<f32>(0.003,0.0085,0.022),vec3<f32>(0.020,0.037,0.063),haze);
  let daylight=mix(vec3<f32>(0.073,0.244,0.433),vec3<f32>(0.40,0.57,0.67),haze);
  let horizon=mix(vec3<f32>(0.22,0.246,0.267),vec3<f32>(0.71,0.34,0.16),pow(towardSun,5.0));
  let dusk=mix(vec3<f32>(0.037,0.080,0.143),horizon,haze);
  let halo=pow(towardSun,38.0)*0.095+pow(towardSun,350.0)*0.15+pow(towardSun,2400.0)*0.24;
  return mix(night,mix(daylight,dusk,light.y),light.x)+sunColor*halo*light.z;
}
`;

const detailDensityWGSL = /* wgsl */`fn detailDensity(p:vec3<f32>,baseDensity:f32)->f32{
  // Repeat in all three axes. Two wind-sheared scales break up the
  // silhouettes and the transition from sunlit turrets to translucent wisps.
  let drift=vec3<f32>(p.x+p.y*0.21,p.y,p.z-p.y*0.12);
  let grain=textureSampleLevel(micro,detailSampler,drift/1170.0,0.0);
  let fine=textureSampleLevel(micro,detailSampler,drift.zxy/483.0+vec3<f32>(0.23,0.49,0.11),0.0);
  let edge=1.0-smoothstep(0.32,0.95,baseDensity);
  let small=textureSampleLevel(micro,detailSampler,drift.yzx/197.0+vec3<f32>(0.67,0.19,0.32),0.0);
  let turbulence=(grain.r-0.36)*0.76+(fine.r-0.36)*0.38+(small.r-0.36)*0.19;
  let erosion=(0.21+turbulence)*edge;
  let support=smoothstep(0.002,0.065,baseDensity);
  return clamp((baseDensity-erosion)*(0.79+0.60*grain.g)*support,0.0,1.0);
}
`;

async function compile(device, code, label) {
  const module = device.createShaderModule({label,code});
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter(x=>x.type==='error');
  if(errors.length) throw Error(label+': '+errors.map(x=>x.message).join('\n'));
  return await device.createComputePipelineAsync({label,layout:'auto',compute:{module,entryPoint:'main'}});
}
async function dispatch(device,pipeline,entries,x,y,z=1){
  const bind=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries});
  const encoder=device.createCommandEncoder();const pass=encoder.beginComputePass();
  pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(x,y,z);pass.end();
  device.queue.submit([encoder.finish()]);await device.queue.onSubmittedWorkDone();
}
async function readHalf(device,tex,w,h,d=1){
  const row=Math.ceil(w*8/256)*256;
  const buffer=device.createBuffer({size:row*h*d,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  const encoder=device.createCommandEncoder();
  encoder.copyTextureToBuffer({texture:tex},{buffer,bytesPerRow:row,rowsPerImage:h},[w,h,d]);
  device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);
  const src=new Uint16Array(buffer.getMappedRange()),dst=new Uint16Array(w*h*d*4);
  for(let z=0;z<d;z++)for(let y=0;y<h;y++)dst.set(src.subarray((z*h+y)*row/2,(z*h+y)*row/2+w*4),(z*h+y)*w*4);
  buffer.unmap();buffer.destroy();return dst;
}

export async function bakeClouds(device,sun,color,light,{volumeSize=256,envWidth=8192,envHeight=4096,steps=512}={}){
  const nx=volumeSize,ny=128,nz=volumeSize;
  const originX=4000;
  const cache=`clouds-cumulus-v3-${nx}-${envWidth}-${envHeight}-${steps}`;
  const sampler=device.createSampler({minFilter:'linear',magFilter:'linear',addressModeU:'repeat',addressModeV:'clamp-to-edge',addressModeW:'repeat'});
  const params=new Float32Array([sun.x,sun.y,sun.z,0,...color,0,light.x,light.y,light.z,0]);
  const uniform=device.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(uniform,0,params);
  let fieldData,envData;
  try{
    fieldData=new Uint16Array((await fs.readFile(`./${cache}-field.bin`)).buffer);
    envData=new Uint16Array((await fs.readFile(`./${cache}-sky.bin`)).buffer);
    if(fieldData.length!==nx*ny*nz*4||envData.length!==envWidth*envHeight*4)throw Error('Cache shape mismatch');
    console.log('Reusing fixed-time volumetric cloud bake');
  }catch{
    const density=device.createTexture({dimension:'3d',size:[nx,ny,nz],format:'rgba16float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING});
    const densityPipeline=await compile(device,common+/*wgsl*/`
@group(0) @binding(0) var outTex:texture_storage_3d<rgba16float,write>;
@compute @workgroup_size(4,4,4) fn main(@builtin(global_invocation_id) id:vec3<u32>){
  let size=textureDimensions(outTex);if(any(id>=size)){return;}
  let uv=(vec3<f32>(id)+0.5)/vec3<f32>(size);
  // A weather cell hosts one slanted updraft and several smaller turrets.
  // Evaluate neighbors so growth crosses cell boundaries without seams.
  let cells=13.0;
  let tile=uv.xz*cells;
  let warp=vec2<f32>(
    noise(vec3<f32>(uv.x*21.0,uv.y*2.4,uv.z*21.0),21.0),
    noise(vec3<f32>(uv.x*21.0,uv.y*2.4+7.4,uv.z*21.0),21.0))-0.5;
  let q=tile+warp*0.33;
  let index=floor(q);
  let y=uv.y;
  var envelope=-3.0;
  for(var j=-1;j<=1;j++){for(var i=-1;i<=1;i++){
    let cell=index+vec2<f32>(f32(i),f32(j));
    let key=cell-floor(cell/cells)*cells;
    let seed=hash3(vec3<f32>(key.x,3.13,key.y));
    let weatherPos=(key+0.5)/cells;
    let weather=noise(vec3<f32>(weatherPos.x*5.0,0.35,weatherPos.y*5.0),5.0);
    let growth=smoothstep(0.20,0.84,weather*0.71+seed.z*0.29);
    let center=cell+0.11+seed.xy*0.78;
    let floorY=0.055+0.16*seed.y+0.052*(1.0-growth);
    let columnHeight=0.11+growth*(0.63+seed.x*0.14);
    let level=(y-floorY)/columnHeight;
    let shear=vec2<f32>(0.23,-0.095)*clamp(level,0.0,1.0)*growth;
    let tilted=q-center-shear;
    let d=vec2<f32>(tilted.x+tilted.y*(seed.y-0.5)*0.76,tilted.y+tilted.x*(seed.x-0.5)*0.31);
    let width=(0.18+0.44*growth)*(0.80+0.30*seed.x);
    let core=1.0-length(vec3<f32>(d.x/(width*1.19), (level-0.29)/0.54, d.y/width));
    var shape=core;
    for(var t=0;t<4;t++){
      let lobe=hash3(vec3<f32>(key.x,f32(t)*9.7+6.2,key.y));
      let angle=6.2831853*(f32(t)+lobe.x*0.7)/4.0;
      let lateral=vec2<f32>(cos(angle),sin(angle))*width*(0.33+lobe.y*0.35);
      let top=0.44+0.33*lobe.z;
      let radius=width*(0.43+0.26*lobe.y);
      let turret=1.0-length(vec3<f32>((d.x-lateral.x)/radius,(level-top)/(0.29+0.14*lobe.x),(d.y-lateral.y)/radius));
      shape=max(shape,turret);
    }
    // A shared condensation level shapes the underside; its edge thins in shear.
    let baseEdge=(y-floorY+warp.x*0.095+warp.y*0.047+0.022)/0.093;
    envelope=max(envelope,min(shape,baseEdge)-(1.0-growth)*0.36);
  }}
  // Coherent three-dimensional folds displace entire cloud faces. Smaller
  // lobes erode those faces most strongly where air and droplets mix.
  let meso=1.0-worley(vec3<f32>(uv.x*43.0,uv.y*3.76,uv.z*43.0),43.0);
  let billow=1.0-worley(vec3<f32>(uv.x*87.0,uv.y*7.61,uv.z*87.0),87.0);
  let folds=noise(vec3<f32>(uv.x*33.0,uv.y*2.9,uv.z*33.0),33.0)-0.5;
  let curls=noise(vec3<f32>(uv.x*104.0,uv.y*9.1,uv.z*104.0),104.0)-0.5;
  let boundary=envelope+(meso-0.43)*0.79+(billow-0.42)*0.47+folds*0.57+curls*0.23;
  let humidity=noise(vec3<f32>(uv.x*27.0,uv.y*2.36,uv.z*27.0),27.0);
  let bulk=smoothstep(-0.10,0.53,boundary)*(0.44+0.52*humidity);
  let baseFade=smoothstep(0.005,0.047,y)*(1.0-smoothstep(0.92,1.0,y));
  textureStore(outTex,vec3<i32>(id),vec4<f32>(bulk*baseFade,0.0,0.0,1.0));
}`,'Cloud density and erosion');
    console.log('Baking 3D cloud density and multi-scale erosion…');
    await dispatch(device,densityPipeline,[{binding:0,resource:density.createView()}],Math.ceil(nx/4),Math.ceil(ny/4),Math.ceil(nz/4));
    // A separate, periodically tiled detail volume preserves 20–100 m erosion
    // without allocating a kilometre-scale, gigabyte-sized density grid.
    const micro=device.createTexture({dimension:'3d',size:[96,96,96],format:'rgba16float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING});
    const microPipeline=await compile(device,common+/*wgsl*/`
@group(0) @binding(0) var outTex:texture_storage_3d<rgba16float,write>;
@compute @workgroup_size(4,4,4) fn main(@builtin(global_invocation_id) id:vec3<u32>){
  let uv=(vec3<f32>(id)+0.5)/96.0;
  let erosion=worley(uv*4.0,4.0)*0.60+worley(uv*8.0,8.0)*0.28+worley(uv*16.0,16.0)*0.12;
  let billow=noise(uv*8.0+vec3<f32>(7.1,3.2,11.6),8.0)*0.65+noise(uv*16.0,16.0)*0.35;
  textureStore(outTex,vec3<i32>(id),vec4<f32>(erosion,billow,0.0,1.0));
}`,'Fine cloud erosion volume');
    await dispatch(device,microPipeline,[{binding:0,resource:micro.createView()}],24,24,24);
    const detailSampler=device.createSampler({minFilter:'linear',magFilter:'linear',addressModeU:'repeat',addressModeV:'repeat',addressModeW:'repeat'});
    const field=device.createTexture({dimension:'3d',size:[nx,ny,nz],format:'rgba16float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_SRC});
    const lightPipeline=await compile(device,common+/*wgsl*/`
struct Params {sun:vec4<f32>,color:vec4<f32>,light:vec4<f32>};
@group(0) @binding(0) var density:texture_3d<f32>;
@group(0) @binding(1) var linearSampler:sampler;
@group(0) @binding(2) var outTex:texture_storage_3d<rgba16float,write>;
@group(0) @binding(3) var<uniform> params:Params;
@group(0) @binding(4) var micro:texture_3d<f32>;
@group(0) @binding(5) var detailSampler:sampler;
${detailDensityWGSL}
@compute @workgroup_size(4,4,4) fn main(@builtin(global_invocation_id) id:vec3<u32>){
  let size=textureDimensions(outTex);if(any(id>=size)){return;}
  let uv=(vec3<f32>(id)+0.5)/vec3<f32>(size);
  let p=vec3<f32>((uv.x-0.5)*WORLD,mix(BASE,TOP,uv.y),(uv.z-0.5)*WORLD);
  let travel=(TOP-p.y)/max(params.sun.y,0.035);
  var optical=0.0;
  for(var i=0;i<72;i++){
    let lo=f32(i)/72.0;let hi=(f32(i)+1.0)/72.0;
    let ds=travel*(hi*hi-lo*lo);
    let pos=p+params.sun.xyz*(travel*(lo*lo+hi*hi)*0.5);
    let bulk=textureSampleLevel(density,linearSampler,cloudUV(pos),0.0).r;
    if(bulk>0.001){optical+=detailDensity(pos,bulk)*ds*0.0048;}
  }
  let rho=textureSampleLevel(density,linearSampler,uv,0.0).r;
  // Sample the open sky above and to the sides of a cloud column.
  var ambient=0.0;
  for(var direction=0;direction<5;direction++){
    let angle=f32(direction)*1.570796327;
    let skyRay=select(vec3<f32>(0.8660254*cos(angle),0.5,0.8660254*sin(angle)),vec3<f32>(0.0,1.0,0.0),direction==0);
    let skyDs=(TOP-p.y)/(skyRay.y*8.0);
    var skyDepth=0.0;
    for(var j=0;j<8;j++){
      let above=p+skyRay*((f32(j)+0.5)*skyDs);
      let bulk=textureSampleLevel(density,linearSampler,cloudUV(above),0.0).r;
      if(bulk>0.001){skyDepth+=detailDensity(above,bulk)*skyDs*0.0034;}
    }
    ambient+=exp(-skyDepth)*select(0.17,0.32,direction==0);
  }
  textureStore(outTex,vec3<i32>(id),vec4<f32>(rho,exp(-optical),ambient,optical));
}`,'Cloud self shadow');
    console.log('Integrating 72 sunlight samples through the cloud volume…');
    await dispatch(device,lightPipeline,[{binding:0,resource:density.createView()},{binding:1,resource:sampler},{binding:2,resource:field.createView()},{binding:3,resource:{buffer:uniform}},{binding:4,resource:micro.createView()},{binding:5,resource:detailSampler}],Math.ceil(nx/4),Math.ceil(ny/4),Math.ceil(nz/4));
    density.destroy();
    const sky=device.createTexture({size:[envWidth,envHeight],format:'rgba16float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_SRC});

    const skyPipeline=await compile(device,common+/*wgsl*/`
struct Params {sun:vec4<f32>,color:vec4<f32>,light:vec4<f32>};
@group(0) @binding(0) var field:texture_3d<f32>;
@group(0) @binding(1) var linearSampler:sampler;
@group(0) @binding(2) var outTex:texture_storage_2d<rgba16float,write>;
@group(0) @binding(3) var<uniform> params:Params;
@group(0) @binding(4) var micro:texture_3d<f32>;
@group(0) @binding(5) var detailSampler:sampler;
${inverseProjectionWGSL}
fn hg(c:f32,g:f32)->f32{return (1.0-g*g)/pow(max(0.001,1.0+g*g-2.0*g*c),1.5);}
${detailDensityWGSL}
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3<u32>){
  let size=textureDimensions(outTex);if(any(id.xy>=size)){return;}
  let uv=(vec2<f32>(id.xy)+0.5)/vec2<f32>(size);
  let signedU=2.0*uv.x-1.0;
  let az=sign(signedU)*angleAt(abs(signedU),${wgslAxis(azimuth)});
  let el=angleAt(uv.y,${wgslAxis(elevation)});
  let ray=vec3<f32>(sin(az)*cos(el),sin(el),-cos(az)*cos(el));
  // The spherical shell prevents an infinite planar cloud wall at the horizon.
  let earth=6371000.0;let origin=vec3<f32>(0.0,4.98,21.0);
  let radial=earth+origin.y;
  let start=-radial*ray.y+sqrt(radial*radial*ray.y*ray.y+(BASE-origin.y)*(2.0*earth+BASE+origin.y));
  let end=-radial*ray.y+sqrt(radial*radial*ray.y*ray.y+(TOP-origin.y)*(2.0*earth+TOP+origin.y));
  let ds=(end-start)/f32(${steps});
  let cosine=dot(ray,params.sun.xyz);
  let phase=0.10*(hg(cosine,0.69)*0.88+hg(cosine,-0.23)*0.12);
  let airlight=clearSky(ray,params.sun.xyz,params.color.xyz,params.light.xyz);
  var T=1.0;var rgb=vec3<f32>(0.0);
  for(var i=0;i<${steps};i++){
    let t=start+(f32(i)+0.5)*ds;
    var p=origin+ray*t;
    p.y+=dot(p.xz,p.xz)/(2.0*earth);
    p.x+=${originX.toFixed(1)};
    let cloud=textureSampleLevel(field,linearSampler,cloudUV(p),0.0);
    if(cloud.r<0.001){continue;}
    let rho=detailDensity(p,cloud.r);
    if(rho>0.0001){
      let tau=rho*ds*0.0048;
      let opacity=1.0-exp(-tau);
      // Recover sub-voxel self-shadow on the illuminated faces: compare
      // the near section of the fine ray with the coarse local average.
      var correction=0.0;
      for(var k=0;k<3;k++){
        let dsLocal=21.0*f32(1<<u32(k));
        let q=p+params.sun.xyz*(1.5*dsLocal-21.0);
        let bulk=textureSampleLevel(field,linearSampler,cloudUV(q),0.0).r;
        let local=detailDensity(q,bulk);
        let mean=max(0.0,bulk-0.21*(1.0-smoothstep(0.32,0.95,bulk)));
        correction+=(local-mean)*dsLocal*0.0048;
      }
      let sunlightDepth=max(0.0,cloud.a+correction);
      let skyVisibility=clamp(cloud.b+(cloud.r-rho)*0.30,0.0,1.0);
      let ambient=vec3<f32>(0.125,0.175,0.242)*(0.16+0.84*skyVisibility);
      let multiple=0.16*exp(-sunlightDepth*0.32)+0.058*exp(-sunlightDepth*0.092);
      let direct=params.color.xyz*(exp(-sunlightDepth)*phase+multiple)*params.light.z;
      let groundBounce=vec3<f32>(0.011,0.025,0.036)*params.light.x;
      let scatter=ambient+direct+groundBounce;
      let aerial=exp(-t*0.000025);
      rgb+=T*opacity*mix(airlight,scatter,aerial);
      T*=1.0-opacity;
      if(T<0.002){break;}
    }
  }
  textureStore(outTex,vec2<i32>(id.xy),vec4<f32>(rgb+T*airlight,T));
}`,'Cloud radiance integration');
    console.log(`Integrating ${steps} cloud steps into the ${envWidth} × ${envHeight} HDR hemisphere…`);
    await dispatch(device,skyPipeline,[{binding:0,resource:field.createView()},{binding:1,resource:sampler},{binding:2,resource:sky.createView()},{binding:3,resource:{buffer:uniform}},{binding:4,resource:micro.createView()},{binding:5,resource:detailSampler}],Math.ceil(envWidth/8),Math.ceil(envHeight/8));
    fieldData=await readHalf(device,field,nx,ny,nz);envData=await readHalf(device,sky,envWidth,envHeight);
    await fs.writeFile(`./${cache}-field.bin`,new Uint8Array(fieldData.buffer));
    await fs.writeFile(`./${cache}-sky.bin`,new Uint8Array(envData.buffer));
    field.destroy();sky.destroy();micro.destroy();console.log('Volumetric cloud lighting bake complete');
  }
  uniform.destroy();
  const fieldTexture=new THREE.Data3DTexture(fieldData,nx,ny,nz);
  fieldTexture.type=THREE.HalfFloatType;fieldTexture.format=THREE.RGBAFormat;
  fieldTexture.minFilter=THREE.LinearFilter;fieldTexture.magFilter=THREE.LinearFilter;
  fieldTexture.wrapS=THREE.RepeatWrapping;fieldTexture.wrapR=THREE.RepeatWrapping;fieldTexture.needsUpdate=true;
  const skyTexture=new THREE.DataTexture(envData,envWidth,envHeight,THREE.RGBAFormat,THREE.HalfFloatType);
  skyTexture.minFilter=THREE.LinearMipmapLinearFilter;skyTexture.magFilter=THREE.LinearFilter;
  skyTexture.wrapS=THREE.RepeatWrapping;skyTexture.generateMipmaps=true;skyTexture.needsUpdate=true;
  // Cosine-weighted hemispheric irradiance divided by pi, excluding the solar disk.
  const diffuseSky = [0, 0, 0];
  let weightSum = 0;
  for (let j = 0; j < 64; j++) {
    const angle = (j + 0.5) / 64 * Math.PI / 2;
    const y = Math.min(envHeight - 1, Math.floor(projectAngle(angle, elevation) * envHeight));
    const weight = Math.cos(angle) * Math.sin(angle);
    for (let i = 0; i < 128; i++) {
      const angleX = ((i + 0.5) / 128 * 2 - 1) * Math.PI;
      const u = 0.5 + Math.sign(angleX) * 0.5 * projectAngle(Math.abs(angleX), azimuth);
      const x = Math.min(envWidth - 1, Math.floor(u * envWidth));
      const offset = (y * envWidth + x) * 4;
      for (let c = 0; c < 3; c++) diffuseSky[c] += THREE.DataUtils.fromHalfFloat(envData[offset + c]) * weight;
      weightSum += weight;
    }
  }
  for (let c = 0; c < 3; c++) diffuseSky[c] /= weightSum;
  return {fieldTexture,skyTexture,diffuseSky,metadata:{volume:[nx,ny,nz],detailVolume:[96,96,96],hemisphere:[envWidth,envHeight],steps,sunlightSteps:72,localSunlightCorrectionSteps:3,ambientDirections:5,ambientSteps:40,diffuseSky,worldPeriod:WORLD,base:BASE,top:TOP,originOffset:[originX,0,0],projection:{azimuth,elevation}}};
}
