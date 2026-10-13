import {useEffect, useState} from 'react';
import {delayRender, continueRender, cancelRender, staticFile} from 'remotion';

export const usePulseFont = () => {
  const [ready, setReady] = useState(false);
  const [handle] = useState(() => delayRender('Load bundled PulseMono font'));
  useEffect(() => {
    const font = new FontFace('PulseMono', `url(${staticFile('PulseMono.ttf')})`);
    let active = true;
    font.load().then((loaded) => {
      document.fonts.add(loaded);
      if (active) { setReady(true); continueRender(handle); }
    }).catch((error) => cancelRender(error));
    return () => { active = false; };
  }, [handle]);
  return ready;
};
