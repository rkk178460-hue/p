import fs from 'node:fs/promises';
import * as THREE from 'three/webgpu';

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
    cell.x = cell.x - floor(cell.x/period)*period;
    cell.z = cell.z - floor(cell.z/period)*period;
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
    cell.x=cell.x-floor(cell.x/period)*period;
    cell.z=cell.z-floor(cell.z/period)*period;
    let delta=offset+hash3(cell)-f;
    nearest=min(nearest,dot(delta,delta));
  }}}
  return clamp(sqrt(nearest),0.0,1.0);
}
fn cloudUV(p:vec3<f32>)->vec3<f32>{
  return vec3<f32>(fract(p.x/WORLD+0.5),clamp((p.y-BASE)/(TOP-BASE),0.0,1.0),fract(p.z/WORLD+0.5));
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

export async function bakeClouds(device,sun,color,{volumeSize=256,envWidth=8192,envHeight=4096,steps=512}={}){
  const nx=volumeSize,ny=96,nz=volumeSize;
  const cache=`clouds-v8-${nx}-${envWidth}-${envHeight}-${steps}`;
  const sampler=device.createSampler({minFilter:'linear',magFilter:'linear',addressModeU:'repeat',addressModeV:'clamp-to-edge',addressModeW:'repeat'});
  const params=new Float32Array([sun.x,sun.y,sun.z,0,color[0],color[1],color[2],0]);
  const uniform=device.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(uniform,0,params);
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
  let a=noise(vec3<f32>(uv.x*7.0,0.35,uv.z*7.0),7.0);
  let b=noise(vec3<f32>(uv.x*15.0,2.6,uv.z*15.0),15.0);
  let weather=a*0.72+b*0.28;
  let coverage=smoothstep(0.43,0.73,weather);
  let broad=noise(vec3<f32>(uv.x*9.0,uv.y*3.8,uv.z*9.0),9.0)*0.64
    +noise(vec3<f32>(uv.x*19.0,uv.y*7.7,uv.z*19.0),19.0)*0.26
    +noise(vec3<f32>(uv.x*39.0,uv.y*15.9,uv.z*39.0),39.0)*0.10;
  let puffy=1.0-worley(vec3<f32>(uv.x*17.0,uv.y*5.1,uv.z*17.0),17.0);
  let shape=mix(broad,puffy,0.30);
  let cloudTop=mix(0.43,0.99,coverage);
  let profile=smoothstep(0.015,0.14,uv.y)*(1.0-smoothstep(cloudTop*0.45,cloudTop,uv.y));
  let baseDensity=clamp((shape-(1.0-coverage)*0.72)*2.8,0.0,1.0)*profile;
  let erosion=worley(vec3<f32>(uv.x*67.0,uv.y*19.0,uv.z*67.0),67.0);
  let fine=noise(vec3<f32>(uv.x*127.0,uv.y*37.0,uv.z*127.0),127.0);
  let rho=max(0.0,baseDensity-erosion*0.21*(1.0-baseDensity)-fine*0.065);
  textureStore(outTex,vec3<i32>(id),vec4<f32>(rho,profile,coverage,1.0));
}`,'Cloud density and erosion');
    console.log('Baking 3D cloud density and multi-scale erosion…');
    await dispatch(device,densityPipeline,[{binding:0,resource:density.createView()}],Math.ceil(nx/4),Math.ceil(ny/4),Math.ceil(nz/4));
    const field=device.createTexture({dimension:'3d',size:[nx,ny,nz],format:'rgba16float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_SRC});
    const lightPipeline=await compile(device,common+/*wgsl*/`
struct Params {sun:vec4<f32>,color:vec4<f32>};
@group(0) @binding(0) var density:texture_3d<f32>;
@group(0) @binding(1) var linearSampler:sampler;
@group(0) @binding(2) var outTex:texture_storage_3d<rgba16float,write>;
@group(0) @binding(3) var<uniform> params:Params;
@compute @workgroup_size(4,4,4) fn main(@builtin(global_invocation_id) id:vec3<u32>){
  let size=textureDimensions(outTex);if(any(id>=size)){return;}
  let uv=(vec3<f32>(id)+0.5)/vec3<f32>(size);
  let p=vec3<f32>((uv.x-0.5)*WORLD,mix(BASE,TOP,uv.y),(uv.z-0.5)*WORLD);
  let travel=(TOP-p.y)/max(params.sun.y,0.035);
  let ds=travel/48.0;var optical=0.0;
  for(var i=0;i<48;i++){
    let pos=p+params.sun.xyz*((f32(i)+0.5)*ds);
    optical+=textureSampleLevel(density,linearSampler,cloudUV(pos),0.0).r*ds*0.0048;
  }
  let rho=textureSampleLevel(density,linearSampler,uv,0.0).r;
  var skyDepth=0.0;
  let skyDs=(TOP-p.y)/12.0;
  for(var j=0;j<12;j++){
    let above=p+vec3<f32>(0.0,(f32(j)+0.5)*skyDs,0.0);
    skyDepth+=textureSampleLevel(density,linearSampler,cloudUV(above),0.0).r*skyDs*0.0025;
  }
  let ambient=exp(-skyDepth);
  textureStore(outTex,vec3<i32>(id),vec4<f32>(rho,exp(-optical),ambient,optical));
}`,'Cloud self shadow');
    console.log('Integrating 48 sunlight samples through the cloud volume…');
    await dispatch(device,lightPipeline,[{binding:0,resource:density.createView()},{binding:1,resource:sampler},{binding:2,resource:field.createView()},{binding:3,resource:{buffer:uniform}}],Math.ceil(nx/4),Math.ceil(ny/4),Math.ceil(nz/4));
    density.destroy();
    // A separate, periodically tiled detail volume preserves 20–100 m erosion
    // without allocating a kilometre-scale, gigabyte-sized density grid.
    const micro=device.createTexture({dimension:'3d',size:[64,64,64],format:'rgba16float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING});
    const microPipeline=await compile(device,common+/*wgsl*/`
@group(0) @binding(0) var outTex:texture_storage_3d<rgba16float,write>;
@compute @workgroup_size(4,4,4) fn main(@builtin(global_invocation_id) id:vec3<u32>){
  let uv=(vec3<f32>(id)+0.5)/64.0;
  let erosion=worley(uv*4.0,4.0)*0.60+worley(uv*8.0,8.0)*0.28+worley(uv*16.0,16.0)*0.12;
  let billow=noise(uv*8.0+vec3<f32>(7.1,3.2,11.6),8.0)*0.65+noise(uv*16.0,16.0)*0.35;
  textureStore(outTex,vec3<i32>(id),vec4<f32>(erosion,billow,0.0,1.0));
}`,'Fine cloud erosion volume');
    await dispatch(device,microPipeline,[{binding:0,resource:micro.createView()}],16,16,16);
    const sky=device.createTexture({size:[envWidth,envHeight],format:'rgba16float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_SRC});
    const skyPipeline=await compile(device,common+/*wgsl*/`
struct Params {sun:vec4<f32>,color:vec4<f32>};
@group(0) @binding(0) var field:texture_3d<f32>;
@group(0) @binding(1) var linearSampler:sampler;
@group(0) @binding(2) var outTex:texture_storage_2d<rgba16float,write>;
@group(0) @binding(3) var<uniform> params:Params;
@group(0) @binding(4) var micro:texture_3d<f32>;
fn hg(c:f32,g:f32)->f32{return (1.0-g*g)/pow(max(0.001,1.0+g*g-2.0*g*c),1.5);}
fn detailDensity(p:vec3<f32>,baseDensity:f32)->f32{
  let grain=textureSampleLevel(micro,linearSampler,fract(p/640.0),0.0);
  return clamp((baseDensity-max(0.0,grain.r-0.18)*0.43*(1.0-baseDensity))*1.08,0.0,1.0);
}
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3<u32>){
  let size=textureDimensions(outTex);if(any(id.xy>=size)){return;}
  let uv=(vec2<f32>(id.xy)+0.5)/vec2<f32>(size);
  let az=(uv.x-0.5)*6.28318530718;let el=uv.y*1.57079632679;
  let ray=vec3<f32>(cos(az)*cos(el),sin(el),sin(az)*cos(el));
  // The spherical shell prevents an infinite planar cloud wall at the horizon.
  let earth=6371000.0;let origin=vec3<f32>(0.0,4.98,21.0);
  let radial=earth+origin.y;
  let start=-radial*ray.y+sqrt(radial*radial*ray.y*ray.y+(BASE-origin.y)*(2.0*earth+BASE+origin.y));
  let end=-radial*ray.y+sqrt(radial*radial*ray.y*ray.y+(TOP-origin.y)*(2.0*earth+TOP+origin.y));
  let ds=(end-start)/f32(${steps});
  let cosine=dot(ray,params.sun.xyz);
  let phase=0.12*(hg(cosine,0.70)*0.86+hg(cosine,-0.25)*0.14);
  var T=1.0;var rgb=vec3<f32>(0.0);
  for(var i=0;i<${steps};i++){
    let t=start+(f32(i)+0.5)*ds;
    var p=origin+ray*t;
    p.y+=dot(p.xz,p.xz)/(2.0*earth);
    p.x+=10500.0;
    let cloud=textureSampleLevel(field,linearSampler,cloudUV(p),0.0);
    let rho=detailDensity(p,cloud.r);
    if(rho>0.0001){
      let tau=rho*ds*0.0048;
      let opacity=1.0-exp(-tau);
      let powder=1.0-exp(-rho*2.5);
      // Correct the local part of the bulk sunlight path for the eroded density.
      var correction=0.0;
      for(var k=0;k<3;k++){
        let segment=48.0*pow(2.0,f32(k));
        let travel=24.0+72.0*f32(k)+72.0*f32(k*k);
        let q=p+params.sun.xyz*travel;
        let bulk=textureSampleLevel(field,linearSampler,cloudUV(q),0.0).r;
        correction+=(detailDensity(q,bulk)-bulk)*segment*0.0048;
      }
      let sunlightDepth=max(0.0,cloud.a+correction);
      let skyVisibility=clamp(cloud.b+(cloud.r-rho)*0.30,0.0,1.0);
      let ambient=vec3<f32>(0.105,0.163,0.235)*(0.28+0.72*skyVisibility);
      let multiple=0.13*exp(-sunlightDepth*0.18)+0.045*exp(-sunlightDepth*0.035);
      let direct=params.color.xyz*(exp(-sunlightDepth)*phase*(0.50+0.50*powder)+multiple);
      let scatter=ambient+direct;
      let aerial=exp(-t*0.000026);
      let distant=vec3<f32>(0.24,0.26,0.30)+params.color.xyz*0.10;
      rgb+=T*opacity*mix(distant,scatter,aerial);
      T*=1.0-opacity;
      if(T<0.002){break;}
    }
  }
  textureStore(outTex,vec2<i32>(id.xy),vec4<f32>(rgb,T));
}`,'Cloud radiance integration');
    console.log(`Integrating ${steps} cloud steps into the ${envWidth} × ${envHeight} HDR hemisphere…`);
    await dispatch(device,skyPipeline,[{binding:0,resource:field.createView()},{binding:1,resource:sampler},{binding:2,resource:sky.createView()},{binding:3,resource:{buffer:uniform}},{binding:4,resource:micro.createView()}],Math.ceil(envWidth/8),Math.ceil(envHeight/8));
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
  return {fieldTexture,skyTexture,metadata:{volume:[nx,ny,nz],detailVolume:[64,64,64],hemisphere:[envWidth,envHeight],steps,sunlightSteps:48,localSunlightCorrectionSteps:3,ambientSteps:12,worldPeriod:WORLD,base:BASE,top:TOP,originOffset:[10500,0,0]}};
}
