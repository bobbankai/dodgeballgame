import { buildPart, LodName, PartKind, ShapeApp } from './Anatomy';
import { meshPart, MeshOut, packedBuffers } from './Mesher';

/** Background sculpting: builds one character part per message. */
interface Job {
  id: number;
  kind: PartKind;
  lod: LodName;
  app: ShapeApp;
}

self.onmessage = (e: MessageEvent<Job>) => {
  const { id, kind, lod, app } = e.data;
  const out = new MeshOut();
  meshPart(buildPart(kind, lod, app), out);
  const part = out.pack();
  (self as unknown as Worker).postMessage({ id, part }, packedBuffers(part));
};
