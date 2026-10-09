import type { Env as AppBindings } from "../src/env";

declare global {
  namespace Cloudflare {
    interface Env extends AppBindings {}
    interface GlobalProps {
      mainModule: typeof import("../src/index");
    }
  }
}
