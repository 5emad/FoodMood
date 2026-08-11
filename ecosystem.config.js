/**
 * PM2 cluster — use all 4 CPU cores (kills single-core event-loop saturation).
 * Deploy: pm2 start ecosystem.config.js
 * Reload with zero downtime: pm2 reload foodmood
 */
module.exports = {
  apps: [
    {
      name: 'foodmood',
      script: 'backend/server.js',
      instances: 'max', // all cores (4 on this host)
      exec_mode: 'cluster',
      max_memory_restart: '1200M', // recycle a worker before it eats the box
      node_args: '--max-old-space-size=1024',
      env: {
        NODE_ENV: 'production',
      },
      // Smooth reload under load
      kill_timeout: 5000,
      listen_timeout: 8000,
      exp_backoff_restart_delay: 200,
    },
  ],
};
