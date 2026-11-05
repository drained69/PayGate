import React from 'react';
import { Composition } from 'remotion';
import { PayGateVideo } from './Video';
import { FPS, TOTAL } from './timeline';

// 1920x1080: one cut for YouTube and X.
export const Root: React.FC = () => (
  <Composition id="Wide" component={PayGateVideo} durationInFrames={TOTAL} fps={FPS} width={1920} height={1080} />
);
