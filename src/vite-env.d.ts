/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WORKER_API_URL: string;
  /** Enables the 3D assembly beta in a non-production/dev deployment. */
  readonly VITE_ASSEMBLY_DEV_MODE?: string;
  /** Allows authenticated admin accounts to bypass the public assembly flag. */
  readonly VITE_ASSEMBLY_ADMIN_BYPASS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.jpg' {
  const src: string;
  export default src;
}

declare module '*.png' {
  const src: string;
  export default src;
}

declare module '*.svg' {
  const src: string;
  export default src;
}
