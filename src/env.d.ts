/// <reference types="vite/client" />

/** Version label from the build (vite.config.ts); '' when there is none. */
declare const __APP_VERSION__: string

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}
