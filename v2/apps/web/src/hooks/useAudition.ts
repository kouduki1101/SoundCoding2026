import { useSyncExternalStore } from 'react';
import { engine } from '../audio/engine';

export function useAudition() {
  return useSyncExternalStore(engine.subscribeAudition, engine.getAuditionState);
}
