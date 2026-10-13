/// <reference types="vite/client" />

/** Version label from the build (vite.config.ts); '' when there is none. */
declare const __APP_VERSION__: string
/** Release channel badge from the build (vite.config.ts): alpha, beta, stable, …; "dev" by default. */
declare const __APP_CHANNEL__: string

/** The help documents (build/help.ts): one page each at `url`. */
declare module 'virtual:help-docs' {
  const docs: { name: string; title: string; description: string; url: string }[]
  export default docs
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}
