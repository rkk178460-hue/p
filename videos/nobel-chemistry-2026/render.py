#!/usr/bin/env python3
"""2026 Chemistry Nobel – deterministic, offline, source-first motion explainer.
Render: python render.py --output chemistry-nobel-2026.mp4
Only requires numpy, Pillow and ffmpeg (plus optional espeak Chinese voice). 
Copyright (c) 2026 project contributors, MIT. Conceptual diagrams only.
"""
import argparse, json, math, subprocess, shutil, os, sys, wave, re
from pathlib import Path
from functools import lru_cache
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import numpy as np
from scipy.io import wavfile
from scipy.signal import resample_poly

ROOT = Path(__file__).resolve().parent
DATA = json.loads((ROOT / 'storyboard.json').read_text(encoding='utf-8'))
FPS=int(DATA['fps']); W=int(DATA['width']); H=int(DATA['height'])
SCENES=DATA['scenes']
BG=(12,21,25); PALE=(235,236,217); DIM=(123,147,149); ACC=(203,218,135); BLUE=(130,190,190); RED=(225,153,115); LINE=(47,68,68)
FONT_SANS='/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
FONT_SERIF='/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc'
FONT_MONO='/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'
@lru_cache(maxsize=30)
def font(size, family='sans'):
    return ImageFont.truetype({'sans':FONT_SANS,'serif':FONT_SERIF,'mono':FONT_MONO}[family],size)

def clamp(v,a=0,b=1):return max(a,min(b,v))
def ease(v):
    v=clamp(v);return v*v*(3-2*v)
def tx(d,xy,text,size=22,color=PALE,fam='sans',anchor=None,spacing=8):
    d.multiline_text(xy,text,font=font(size,fam),fill=color,spacing=spacing,anchor=anchor)
def circle(d,x,y,r,fill,outline=None,width=2):
    d.ellipse((int(x-r),int(y-r),int(x+r),int(y+r)),fill=fill,outline=outline,width=width)
def poly(d,points,fill=None,outline=BLUE,width=2):
    if fill:d.polygon(points,fill=fill)
    if outline:d.line(points+[points[0]],fill=outline,width=width,joint='curve')
def coords(cx,cy,r,n,rot=0):
    return [(cx+math.cos(i*math.tau/n+rot)*r,cy+math.sin(i*math.tau/n+rot)*r) for i in range(n)]

def atom(d,cx,cy,hand=1,t=0,scale=1):
    # Schematic stereogenic center: bonds drawn in two dimensions, not an exact molecular structure.
    r=104*scale; xoff=27*math.sin(t*.25)
    p=[(cx+hand*(-.75*r)+xoff,cy-.74*r),(cx+hand*(.91*r),cy-.45*r),
       (cx+hand*(.81*r),cy+.88*r),(cx+hand*(-.93*r),cy+.54*r)]
    cols=[ACC,BLUE,RED,PALE]
    for i,(x,y) in enumerate(p):
        d.line((cx,cy,x,y),fill=(80,114,112),width=[5,6,3,4][i]);circle(d,x,y,14*scale,cols[i]);circle(d,x,y,5*scale,BG)
    circle(d,cx,cy,27*scale,(45,78,76));circle(d,cx,cy,11*scale,PALE)

def graph_axes(d,x0=776,y0=490,x1=1181,y1=200):
    d.line((x0,y0,x1,y0),fill=DIM,width=2);d.line((x0,y0,x0,y1),fill=DIM,width=2)
    for i in range(1,5):
        y=int(y0-(y0-y1)*i/4);d.line((x0,y,x1,y),fill=(33,53,53),width=1)
    return x0,y0,x1,y1

def graph_curve(d,p):
    x0,y0,x1,y1=graph_axes(d)
    d.line((x0,y0,x1,y1),fill=(77,94,88),width=2)
    pts=[]
    for i in range(85):
        q=i/84; yy=1-(1-q)**2.8
        pts.append((int(x0+(x1-x0)*q),int(y0-(y0-y1)*yy)))
    n=int(len(pts)*clamp((p-.04)*1.65)); d.line(pts[:max(n,2)],fill=ACC,width=5,joint='curve')
    k=min(84,max(0,n-1));circle(d,*pts[k],7,ACC)
    tx(d,(x0+85,y1-36),'非线性响应 / 示意',20,ACC)
    tx(d,(x0+145,y0+16),'催化剂 ee  →',18,DIM)
    tx(d,(x0-40,y1-60),'产物 ee',17,DIM)

def bars(d,p,values=(.5,.5),label='R / S'):
    x0,y0,x1,y1=graph_axes(d,760,482,1188,200)
    vals=[max(.001,v) for v in values]
    for i,v in enumerate(vals):
        x=885+i*155; bh=230*v
        d.rounded_rectangle((x,y0-bh,x+75,y0),radius=7,fill=ACC if i==0 else BLUE)
        tx(d,(x+37,y0-bh-39),f'{v*100:.1f}%',22,PALE,anchor='mt')
        tx(d,(x+37,y0+15),['R','S'][i],20,DIM,anchor='mt')
    tx(d,(940,528),label,17,DIM,anchor='mt')

def ring_arrows(d,cx,cy,t,rad=120):
    for a in range(3):
        pts=[]
        for i in range(50):
            v=(i/49)*1.57 + t*.12 + a*math.tau/3
            pts.append((cx+math.cos(v)*rad,cy+math.sin(v)*rad))
        d.line(pts,fill=[ACC,BLUE,(108,145,129)][a],width=5,joint='curve')
        x,y=pts[-1];v=math.atan2(y-cy,x-cx)+math.pi/2
        d.polygon([(x+14*math.cos(v),y+14*math.sin(v)),(x-12*math.cos(v)-10*math.cos(v+math.pi/2),y-12*math.sin(v)-10*math.sin(v+math.pi/2)),(x-12*math.cos(v)+10*math.cos(v+math.pi/2),y-12*math.sin(v)+10*math.sin(v+math.pi/2))],fill=[ACC,BLUE,(108,145,129)][a])

def diagram(im,scene,p,t):
    d=ImageDraw.Draw(im);typ=scene['type'];cx=960;cy=345
    if typ=='mirror':
        atom(d,839,340,-1,t,.77);atom(d,1080,340,1,t,.77)
        d.line((960,208,960,475),fill=LINE,width=2)
        for j in range(10):d.line((955,218+j*25,965,218+j*25),fill=DIM,width=1)
        tx(d,(842,505),'L',24,ACC,anchor='mm');tx(d,(1075,505),'R',24,BLUE,anchor='mm')
        tx(d,(965,177),'MIRROR PLANE',14,DIM,'mono',anchor='mt')
    elif typ=='laureates':
        for i,(name,role,c) in enumerate([('HENRI B. KAGAN','NONLINEAR EFFECT',ACC),('KENSO SOAI','AUTOCATALYSIS',BLUE)]):
            x=748; yy=190+i*170
            d.rounded_rectangle((x,yy,x+465,yy+138),radius=6,outline=LINE,width=2)
            d.rectangle((x,yy,x+5,yy+138),fill=c)
            tx(d,(x+24,yy+24),name,27,PALE,'mono');tx(d,(x+24,yy+85),role,16,c,'mono')
    elif typ=='life':
        for i in range(70):
            a=i/69;t2=(a*math.tau*2.8)+(t*.25)
            y=165+a*337;x1=cx-70*math.cos(t2);x2=cx+70*math.cos(t2)
            col=(78,116,111) if i%3 else (111,154,145)
            d.line((x1,y,x2,y),fill=col,width=3)
            circle(d,x1,y,6,ACC);circle(d,x2,y,6,BLUE)
        tx(d,(960,525),'Molecular handedness / 示意',15,DIM,'sans',anchor='mt')
    elif typ=='receptor':
        # geometric receptor pocket and fit silhouette, deliberately stylized
        s=math.sin(t*.45)*15
        pts=[(755,250),(850,250),(890,300),(930,300),(970,268),(1010,300),(1050,300),(1095,250),(1190,250),(1190,450),(755,450)]
        poly(d,pts,fill=(27,48,49),outline=BLUE,width=3)
        for i in range(6):
            x=880+i*40;sx=x+(s if i==0 else 0);circle(d,sx,197+math.sin(t+i)*5,10,ACC)
        d.line([(900,310),(960,370),(1020,310)],fill=ACC,width=6)
        tx(d,(968,489),'受体表面 / 概念图',17,DIM,anchor='mt')
    elif typ=='bars':bars(d,p,(.5,.5),'R : S = 1 : 1')
    elif typ=='ee':
        frac=.5 + .05*ease((p-.1)*2)
        bars(d,p,(frac,1-frac),'55 : 45 → ee = 10%')
        tx(d,(980,155),'ee = |R − S| / (R + S)',20,ACC,anchor='mt')
    elif typ=='curve':graph_curve(d,p)
    elif typ=='networks':
        nodes=[(798,252),(901,204),(1010,267),(1122,216),(858,407),(991,449),(1139,416),(1015,356)]
        links=[(0,1),(1,2),(2,3),(0,4),(4,5),(5,6),(2,7),(7,5),(7,6)]
        for a,b in links:
            x1,y1=nodes[a];x2,y2=nodes[b];d.line((x1,y1,x2,y2),fill=LINE,width=4)
        for i,(x,y) in enumerate(nodes):
            x+=9*math.sin(t*.8+i);y+=9*math.cos(t*.65+i)
            circle(d,x,y,24 if i in (1,5,7) else 16,ACC if i in (1,5,7) else BLUE)
        tx(d,(968,520),'催化物种之间的缔合 / 概念图',17,DIM,anchor='mt')
    elif typ=='feedback':
        ring_arrows(d,966,340,t)
        circle(d,966,340,55,fill=(28,55,51));tx(d,(966,338),'R',50,ACC,'mono',anchor='mm')
        tx(d,(966,520),'产物  →  催化  →  更多同手性产物',17,DIM,anchor='mt')
    elif typ=='amplify':
        k=ease(p);v=.501 + .479*k*k*(3-2*k);bars(d,p,(v,1-v),'仅用于演示的放大路径')
        tx(d,(980,155),'0.2% INITIAL DIFFERENCE',17,ACC,'mono',anchor='mt')
    elif typ=='timeline':
        x0=778;y0=375;x1=1191
        d.line((x0,y0,x1,y0),fill=LINE,width=5)
        for i,(year,c,label) in enumerate([('1986',ACC,'非线性效应'),('1995',BLUE,'自催化反应'),('2003',PALE,'高度同手性')]):
            x=x0+i*(x1-x0)/2
            circle(d,x,y0,11,c)
            tx(d,(x,y0-110),year,33,c,'mono',anchor='mt');tx(d,(x,y0+35),label,18,PALE,anchor='mt')
        circle(d,x0+(x1-x0)*p,y0,6,PALE)
    elif typ=='applications':
        positions=[(820,'MEDICINE','药物'),(972,'MATERIALS','材料'),(1125,'SYNTHESIS','合成')]
        for j,(x,en,cn) in enumerate(positions):
            y=340+5*math.sin(t*.8+j)
            circle(d,x,y,61,(27,48,48),outline=LINE,width=3)
            if j==0:
                d.rounded_rectangle((x-26,y-9,x+26,y+9),radius=8,outline=ACC,width=3)
                d.line((x,y-8,x,y+8),fill=ACC,width=3)
            elif j==1:
                poly(d,coords(x,y,31,6,math.pi/6),outline=BLUE,width=4)
            else:
                for a,b in zip(coords(x,y,30,3),coords(x,y,30,3)[1:]+coords(x,y,30,3)[:1]):d.line((*a,*b),fill=ACC,width=4)
            tx(d,(x,y+85),en,13,DIM,'mono',anchor='mt');tx(d,(x,y+108),cn,20,PALE,anchor='mt')
    elif typ=='compare':
        for i,(s,meta,c) in enumerate([('非线性效应','INPUT → OUTPUT',ACC),('不对称自催化','PRODUCT → PRODUCT',BLUE)]):
            x=750+i*232;y=225
            d.rounded_rectangle((x,y,x+220,y+246),radius=8,outline=LINE,width=2)
            tx(d,(x+18,y+35),str(i+1).zfill(2),23,c,'mono');tx(d,(x+18,y+100),s,27,PALE)
            tx(d,(x+18,y+182),meta,11,c,'mono')
    elif typ=='final':
        for j in range(85):
            a=j*.24+t*.15;rad=12+j*2.4
            circle(d,970+rad*math.cos(a),337+rad*.67*math.sin(a),3+2*(j%7==0),ACC if j%2 else BLUE)
        tx(d,(970,340),'2026',56,PALE,'mono',anchor='mm')
    else:ring_arrows(d,cx,cy,t)

@lru_cache(maxsize=48)
def subtitle_batches(i):
    narration=SCENES[i]['narration']
    # split into natural clause-sized subtitle blocks, independent of voice engine
    phrases=[a.strip() for a in re.split(r'(?<=[。！？；，])',narration) if a.strip()]
    batches=[];buff=''
    for phrase in phrases:
        if len(buff)+len(phrase)>40 and buff:batches.append(buff);buff=''
        buff+=phrase
    if buff:batches.append(buff)
    return batches or [narration]

@lru_cache(maxsize=32)
def base_scene(i):
    s=SCENES[i];im=Image.new('RGB',(W,H),BG);d=ImageDraw.Draw(im)
    d.line((72,87,1209,87),fill=LINE,width=2)
    tx(d,(72,46),'NOBEL  /  CHEMISTRY  /  2026',17,ACC,'mono')
    tx(d,(1206,46),f'{i+1:02d} / {len(SCENES):02d}',16,DIM,'mono',anchor='rt')
    tx(d,(72,130),s['kicker'],15,ACC,'mono')
    tx(d,(66,191),s['title'],53,PALE,'serif',spacing=13)
    # body text left, short lines arranged not to interfere with subtitles
    for j,section in enumerate(s['sections'][:2]):
        tx(d,(73,402+j*80),section,21,DIM,'sans',spacing=6)
    d.line((73,567,1206,567),fill=LINE,width=2)
    d.line((690,143,690,536),fill=(33,54,54),width=2)
    return im

def draw_frame(i,frac,frame_global):
    s=SCENES[i];p=clamp(frac/s['duration']);t=frac
    im=base_scene(i).copy();d=ImageDraw.Draw(im)
    # consistent, delicate motion treatment; avoids random frame jitter
    for j in range(11):
        x=738+((j*49+int(t*8))%470);y=164+((j*71)%338)
        circle(d,x,y,1,(48,70,69))
    diagram(im,s,p,t)
    d=ImageDraw.Draw(im)
    batches=subtitle_batches(i)
    # approximate line timing based on text length; exact SRT available beside the source
    cum=0;total=sum(len(b) for b in batches)
    for b in batches:
        r=len(b)/total
        if p<cum+r+1e-6:break
        cum+=r
    subtitle=b
    if len(subtitle)>37:
        # split into two lines on punct or at a visually safe char limit
        split=max([k for k in range(15,min(38,len(subtitle))) if subtitle[k] in '，、。；：'] or [min(33,len(subtitle))])
        subtitle=subtitle[:split+1]+'\n'+subtitle[split+1:]
    tx(d,(76,593),subtitle,23,PALE,spacing=9)
    d.rectangle((0,H-5,int(W*(frame_global+1)/(sum(s2['duration'] for s2 in SCENES)*FPS)),H),fill=ACC)
    return im

def srt_time(sec):
    ms=round(sec*1000);return f'{ms//3600000:02d}:{ms//60000%60:02d}:{ms//1000%60:02d},{ms%1000:03d}'

def write_srt():
    out=[];k=1;t=0
    for i,s in enumerate(SCENES):
        batches=subtitle_batches(i);n=sum(len(b) for b in batches)
        acc=0
        for b in batches:
            dur=s['duration']*len(b)/n
            out.extend([str(k),f'{srt_time(t+acc)} --> {srt_time(t+acc+dur)}',b,'']);k+=1;acc+=dur
        t+=s['duration']
    (ROOT/'subtitles.zh.srt').write_text('\n'.join(out),encoding='utf-8')

def voice_scenes():
    """Use local espeak if present. Voice intentionally labeled synthetic; no external services."""
    if not shutil.which('espeak'):
        print('No espeak installed: delivering music-only track; see README.',file=sys.stderr);return None
    temp=ROOT/'_voice';temp.mkdir(exist_ok=True)
    outs=[]
    for i,s in enumerate(SCENES):
        wav=temp/f'{i+1:02d}.wav'
        if not wav.exists():
            r=subprocess.run(['espeak','-v','zh','-s','192','-a','145','-w',str(wav),s['narration']],capture_output=True)
            if r.returncode:raise RuntimeError(r.stderr.decode(errors='replace'))
        # use atempo to make speech fit within scene without pitch shift
        rate,sig=wavfile.read(wav)
        secs=len(sig)/rate
        duration=s['duration']-1.2
        stretch=max(1.0,secs/duration)
        aud=temp/f'{i+1:02d}-fit.wav'
        if not aud.exists():
            filt=f'atempo={stretch:.5f}' if stretch<=2 else f'atempo=2.0,atempo={stretch/2:.5f}'
            subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(wav),'-af',f'{filt},aresample=48000','-ac','1',str(aud)],check=True)
        outs.append(aud)
    return outs

def audio_mix(total,with_voice=True):
    rate=48000;n=int(total*rate)
    # unobtrusive original synthetic ambient score, composed entirely from sine tones
    t=np.arange(n,dtype=np.float32)/rate
    music=np.zeros(n,dtype=np.float32)
    # drones + bell accents with segment-dependent pitch, faded boundaries
    progression=[0,3,5,7,0,8,3,5]
    for q in range(math.ceil(total/8)):
        st=q*8;end=min(st+8,total);base=progression[q%len(progression)]
        ix0=int(st*rate);ix1=int(end*rate);tt=t[ix0:ix1]-st
        f=110*2**(base/12)
        env=np.sin(np.pi*np.clip(tt/8,0,1))**1.2
        sub=(.5*np.sin(2*np.pi*f*tt)+.23*np.sin(2*np.pi*(f*1.5)*tt)+.12*np.sin(2*np.pi*(f*2)*tt))
        music[ix0:ix1]+=.11*env*sub
        for onset in [0,3.5,6.5]:
            delta=tt-onset
            bell=np.where(delta>=0,np.exp(-np.maximum(delta,0)*2.8)*np.sin(2*np.pi*(f*4)*delta),0)
            music[ix0:ix1]+=.020*bell
    # Tiny rhythmic breathing under voice
    music*=np.minimum(1,t/1.5)*np.minimum(1,(total-t)/2.0)
    if with_voice:
        voices=voice_scenes()
        if voices:
            offset=0
            for s,path in zip(SCENES,voices):
                sr,v=wavfile.read(path)
                if v.ndim>1:v=v.mean(axis=1)
                if sr!=rate:v=resample_poly(v,rate,sr)
                v=v.astype(np.float32)/(32768 if v.dtype==np.int16 else max(float(np.max(np.abs(v))),1))
                max_samples=int((s['duration']-.5)*rate)
                if len(v)>max_samples:v=v[:max_samples]
                loc=int((offset+.35)*rate);amt=min(len(v),n-loc)
                if amt>0:
                    music[loc:loc+amt]*=.45
                    music[loc:loc+amt]+=.55*v[:amt]
                offset+=s['duration']
    music=np.clip(music,-.92,.92)
    output=ROOT/'audio.wav';wavfile.write(output,rate,(music*32767).astype(np.int16))
    return output

def render(output,audio=True,preview=False):
    write_srt();total=sum(s['duration'] for s in SCENES)
    if preview:
        # contact sheet from representative frames and clean cover image
        thumbs=[]
        for i,s in enumerate(SCENES):
            im=draw_frame(i,s['duration']*.52,0)
            if i==0:im.save(ROOT/'poster.png')
            im.thumbnail((320,180),Image.Resampling.LANCZOS);thumbs.append(im)
        sheet=Image.new('RGB',(320*4,180*4),BG)
        for k,im in enumerate(thumbs):sheet.paste(im,((k%4)*320,(k//4)*180))
        sheet.save(ROOT/'contact-sheet.png')
        print('Preview created');return
    soundtrack=audio_mix(total,with_voice=audio)
    cmd=['ffmpeg','-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','pipe:0',
        '-i',str(soundtrack),'-map','0:v:0','-map','1:a:0','-c:v','libx264','-preset','veryfast','-crf','22','-pix_fmt','yuv420p','-c:a','aac','-b:a','160k','-movflags','+faststart','-shortest',str(output)]
    proc=subprocess.Popen(cmd,stdin=subprocess.PIPE)
    count=0
    try:
        for i,s in enumerate(SCENES):
            for f in range(s['duration']*FPS):
                proc.stdin.write(draw_frame(i,f/FPS,count).tobytes());count+=1
            print(f'Rendered scene {i+1:02d}/{len(SCENES)} ({count/FPS:.0f}s)',flush=True)
        proc.stdin.close();code=proc.wait()
    except BrokenPipeError as e:
        proc.wait();raise RuntimeError('ffmpeg encoder failed') from e
    if code:raise RuntimeError(f'ffmpeg exit {code}')
    print(f'VIDEO: {output} {count} frames ({count/FPS:.2f} s)',flush=True)

if __name__=='__main__':
    ap=argparse.ArgumentParser()
    ap.add_argument('--output',default=str(ROOT/'chemistry-nobel-2026.mp4'))
    ap.add_argument('--no-voice',action='store_true',help='Soundtrack only; optional when espeak unavailable')
    ap.add_argument('--preview',action='store_true',help='Generate 16-frame contact sheet and poster only')
    a=ap.parse_args();render(Path(a.output),not a.no_voice,a.preview)