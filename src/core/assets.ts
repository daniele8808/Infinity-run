import {
  AnimationGroup, Color3, Mesh, PBRMaterial, Scene, SceneLoader,
  StandardMaterial, TransformNode,
} from '@babylonjs/core';

export interface LoadedModel {
  root: TransformNode;
  meshes: Mesh[];
  animationGroups: AnimationGroup[];
}

/** Carica un GLB e restituisce radice, mesh e animazioni. */
export async function loadModel(scene: Scene, url: string, name: string): Promise<LoadedModel> {
  const result = await SceneLoader.ImportMeshAsync('', '', url, scene, undefined, '.glb');
  const root = new TransformNode(`model_${name}`, scene);
  for (const m of result.meshes) {
    if (!m.parent) m.parent = root;
  }
  return {
    root,
    meshes: result.meshes.filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0),
    animationGroups: result.animationGroups,
  };
}

/**
 * Converte i materiali PBR del GLB in StandardMaterial cartoon:
 * senza environment texture i PBR risultano spenti, mentre lo stile
 * low-poly vive di colori pieni e luce semplice.
 */
export function toonify(meshes: Mesh[], scene: Scene): void {
  const cache = new Map<string, StandardMaterial>();
  for (const m of meshes) {
    const mat = m.material;
    if (!(mat instanceof PBRMaterial)) continue;
    let std = cache.get(mat.name);
    if (!std) {
      std = new StandardMaterial(`std_${mat.name}`, scene);
      const base = mat.albedoColor?.clone() ?? Color3.White();
      std.diffuseColor = base;
      if (mat.albedoTexture) std.diffuseTexture = mat.albedoTexture;
      // Lift cartoon: schiarisce i lati in ombra per un look più luminoso.
      std.emissiveColor = base.scale(0.3);
      std.specularColor = new Color3(0.04, 0.04, 0.04);
      cache.set(mat.name, std);
    }
    m.material = std;
  }
}

/**
 * Carica un GLB statico e lo fonde in un'unica mesh instanziabile
 * (per vegetazione, rocce, props: una draw call per tipo + istanze).
 */
export async function loadMergedProp(scene: Scene, url: string, name: string): Promise<Mesh | null> {
  const { root, meshes } = await loadModel(scene, url, name);
  if (!meshes.length) return null;
  toonify(meshes, scene);
  const merged = Mesh.MergeMeshes(meshes, true, true, undefined, false, true);
  if (!merged) return null;
  merged.name = `prop_${name}`;
  merged.setEnabled(false);
  merged.isPickable = false;
  root.dispose();
  return merged;
}
