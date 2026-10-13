#!/usr/bin/env python3
import json, subprocess, sys, os, math
from pathlib import Path
p=Path(sys.argv[1] if len(sys.argv)>1 else Path(__file__).parent/'chemistry-nobel-2026.mp4')
if not p.is_file(): raise SystemExit('missing MP4: '+str(p))
r=subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(p)])
x=json.loads(r)
v=next(a for a in x['streams'] if a['codec_type']=='video')
a=next((a for a in x['streams'] if a['codec_type']=='audio'),None)
sb=json.loads((Path(__file__).parent/'storyboard.json').read_text(encoding='utf8'))
expected=sum(s['duration'] for s in sb['scenes'])
actual=float(x['format']['duration'])
assert (v['width'],v['height'],v['codec_name'])==(1280,720,'h264'),v
assert v['avg_frame_rate']=='24/1',v
assert a and a['codec_name']=='aac',a
assert abs(actual-expected)<.15,(actual,expected)
assert p.stat().st_size>500_000,p.stat().st_size
# Complete decode rejects broken NAL units and truncation.
subprocess.run(['ffmpeg','-v','error','-xerror','-i',str(p),'-f','null','-'],check=True)
print('PASS:',p.name, f'{expected}s', '1280x720', '24fps','H.264/AAC',f'{p.stat().st_size/1e6:.1f}MB','full decode')