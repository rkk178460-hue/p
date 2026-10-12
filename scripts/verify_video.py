#!/usr/bin/env python3
"""Verify silent H.264 delivery metadata and decode every frame using FFmpeg."""
import argparse
import json
import subprocess
from fractions import Fraction

def run(args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout

def verify(path, duration, fps, width, height):
    probe = json.loads(run(['ffprobe', '-v', 'error', '-count_frames', '-show_streams',
                           '-show_format', '-of', 'json', path]))
    videos = [s for s in probe['streams'] if s['codec_type'] == 'video']
    errors = []
    if len(videos) != 1: raise ValueError('Expected exactly one video stream')
    stream = videos[0]
    expected = {'codec_name': 'h264', 'pix_fmt': 'yuv420p', 'width': width, 'height': height}
    for key, value in expected.items():
        if stream.get(key) != value: errors.append(f'{key}: expected {value}, got {stream.get(key)}')
    if Fraction(stream['avg_frame_rate']) != fps: errors.append('Unexpected frame rate')
    count = int(stream['nb_read_frames'])
    if count != round(duration * fps): errors.append(f'Expected {round(duration * fps)} frames, got {count}')
    if abs(float(probe['format']['duration']) - duration) > 1 / fps: errors.append('Unexpected duration')
    if any(s['codec_type'] == 'audio' for s in probe['streams']): errors.append('First edition is deliberately silent')
    if errors: raise ValueError('; '.join(errors))
    run(['ffmpeg', '-v', 'error', '-xerror', '-i', path, '-f', 'null', '-'])
    print(json.dumps({'path': path, 'duration_seconds': duration, 'fps': fps,
                      'frames': count, **expected, 'audio': False, 'full_decode': 'passed'}, indent=2))
    return probe

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('path')
    parser.add_argument('--duration', type=float, default=15)
    parser.add_argument('--fps', type=int, default=60)
    parser.add_argument('--width', type=int, default=1920)
    parser.add_argument('--height', type=int, default=1080)
    args = parser.parse_args()
    verify(args.path, args.duration, args.fps, args.width, args.height)
