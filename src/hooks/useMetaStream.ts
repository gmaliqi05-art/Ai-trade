// Hook React për të lexuar snapshot-in e lidhjes direkte streaming (metaStream).
import { useEffect, useState } from 'react';
import { metaStream, type StreamSnapshot } from '../services/metaStream';

export function useMetaStream(): StreamSnapshot {
  const [snap, setSnap] = useState<StreamSnapshot>(() => metaStream.getSnapshot());
  useEffect(() => metaStream.subscribe(setSnap), []);
  return snap;
}
