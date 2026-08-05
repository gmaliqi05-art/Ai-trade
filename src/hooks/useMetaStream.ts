// Hook React për të lexuar snapshot-in e lidhjes direkte streaming (metaStream).
import { useEffect, useState } from 'react';
import { metaStream, type StreamSnapshot } from '../services/metaStream';

/** Sa gjatë pa lëvizur çmimi para se lidhja direkte të mos quhet më "e shëndetshme"
 *  (dhe ekrani të bjerë te polling-u i REST-it si rezervë). */
const HEALTHY_MS = 6000;

export interface StreamView extends StreamSnapshot {
  /** E lidhur DHE po jep tik-e të freskëta. Vetëm atëherë fiket REST-i. */
  healthy: boolean;
}

/* FRESKIA MATET KËTU, JO TE SNAPSHOT-I.
 *
 * Më parë secili ekran e llogariste vetë me 'updatedAt - lastTickAt'. Kjo pushoi së funksionuari
 * kur metaStream nisi të njoftojë vetëm në ndryshime: 'updatedAt' do të thotë tani "ndryshimi i
 * fundit", ndaj një lidhje e vdekur — që nuk ndryshon kurrë — do të dukej përjetësisht e freskët.
 *
 * Prandaj freskia matet me orën aktuale, e rivlerësuar nga një rrahje e vetme çdo sekondë. Një
 * interval, jo pesë rirenderime në sekondë, dhe e njëjta e vërtetë për çdo ekran që e përdor. */
export function useMetaStream(): StreamView {
  const [snap, setSnap] = useState<StreamSnapshot>(() => metaStream.getSnapshot());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => metaStream.subscribe(setSnap), []);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const healthy = snap.status === 'live' && snap.lastTickAt > 0
    && (Math.max(now, snap.lastTickAt) - snap.lastTickAt) < HEALTHY_MS;

  return { ...snap, healthy };
}
