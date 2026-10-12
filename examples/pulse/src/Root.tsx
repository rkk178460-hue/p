import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {Composition, Folder, registerRoot, useCurrentFrame, useVideoConfig, delayRender, continueRender, cancelRender, staticFile} from 'remotion';
import {draw} from './draw';
import {drawParallax, drawMaskTrails} from './studies';

type Painter = (ctx: CanvasRenderingContext2D, frame: number, width: number, height: number, fps: number) => void;
const CanvasScene = ({paint}: {paint: Painter}) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const frame = useCurrentFrame();
  const {width, height, fps} = useVideoConfig();
  const [fontReady, setFontReady] = useState(false);
  const [handle] = useState(() => delayRender('Load bundled PulseMono font'));
  useEffect(() => {
    const font = new FontFace('PulseMono', `url(${staticFile('PulseMono.ttf')})`);
    let active = true;
    font.load().then((loaded) => {
      document.fonts.add(loaded);
      if (active) { setFontReady(true); continueRender(handle); }
    }).catch((error) => cancelRender(error));
    return () => { active = false; };
  }, [handle]);
  useLayoutEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (ctx && fontReady) paint(ctx, frame, width, height, fps);
  }, [frame, width, height, fps, fontReady, paint]);
  return <canvas ref={ref} width={width} height={height} style={{display: 'block'}} />;
};
const Pulse = () => <CanvasScene paint={draw}/>;
const ParallaxStudy = () => <CanvasScene paint={drawParallax}/>;
const MaskTrailsStudy = () => <CanvasScene paint={drawMaskTrails}/>;
const Root = () => <>
  <Composition id="Pulse" component={Pulse} durationInFrames={900} fps={60} width={1920} height={1080}/>
  <Folder name="Studies">
    <Composition id="ParallaxStudy" component={ParallaxStudy} durationInFrames={360} fps={60} width={1920} height={1080}/>
    <Composition id="MaskTrailsStudy" component={MaskTrailsStudy} durationInFrames={240} fps={60} width={1920} height={1080}/>
  </Folder>
</>;
registerRoot(Root);
