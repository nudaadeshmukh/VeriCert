/** @type {import('next').NextConfig} */
const nextConfig = {
  // Don't advertise the framework. (Security headers are Phase 8's scope.)
  poweredByHeader: false,
  // Next 16 otherwise writes an AGENTS.md into the repo; CLAUDE.md is the single source of
  // project instructions.
  agentRules: false,
};

export default nextConfig;
