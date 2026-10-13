import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import {formAt} from './form-geometry';
import {palette} from './palette';
import {usePulseFont} from './font';

export const Form = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const ready = usePulseFont();
  const t = Math.min(frame / fps, 13.5);
  const state = formAt(t);
  if (!ready) return null;
  return <svg viewBox="0 0 1280 720" width="100%" height="100%" style={{display: 'block', background: palette.background}}>
    <rect width="1280" height="720" fill={palette.background}/>
    <g transform="translate(640 360)" fill="none" strokeLinecap="round" strokeLinejoin="round">
      {[5, 4, 3, 2, 1].map(i => <path key={i} d={formAt(Math.max(0, t - i * 0.065)).d}
        stroke={i === 3 ? palette.accent : '#63727c'} strokeWidth="1.2" opacity={(0.2 - i * 0.025) * (1 - state.depth)}/>)}
      <path d={state.d} stroke="#344149" strokeWidth="1.2" opacity={1 - state.depth}/>
      <path d={state.d} stroke={palette.foreground} strokeWidth="3.5" pathLength="1" strokeDasharray="1 1"
        strokeDashoffset={1 - state.reveal} opacity={1 - state.depth}/>
      <g opacity={state.depth}>
        {state.segments.map(segment => <g key={segment.id}>
          <path d={segment.eraseD} stroke={palette.background} strokeWidth="9" strokeLinecap="butt"/>
          <path d={segment.d} stroke={segment.id < 16 ? palette.accent : palette.foreground}
            strokeWidth="3.2" opacity={Math.max(0.35, Math.min(1, 0.8 - segment.depth / 340))}/>
        </g>)}
      </g>
    </g>
    <g fontFamily="PulseMono" fill={palette.foreground}>
      <text x="56" y="68" fontSize="32">F O R M</text>
      <rect x="56" y="88" width="24" height="2" fill={palette.accent}/>
      <text x="56" y="666" fontSize="16" fill={palette.muted}>{state.phase}</text>
      <text x="1224" y="666" textAnchor="end" fontSize="16" fill={palette.muted}>ONE PATH / THREE DIMENSIONS</text>
    </g>
  </svg>;
};
