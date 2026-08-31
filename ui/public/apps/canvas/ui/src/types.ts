export interface Scene {
  id: number;
  name: string;
  position: number;
  element_count: number | null;
  created_at: number;
  updated_at: number;
}

export interface SceneData {
  scene: Scene;
  version: number;
  elements: readonly unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}
