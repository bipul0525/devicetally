declare namespace Cloudflare {
  interface Env {
    DB: D1Database
    SETUP_TOKEN: string
    RELEASE_REPO: string
    TEST_MIGRATIONS: import('cloudflare:test').D1Migration[]
  }
}
