module.exports = {
  apps: [
    {
      name: 'arcod-fastify',
      script: 'dist/index.js',
      cwd: '/home/fufu/ARCOD-Qobuz-DL/server',
      instances: 1,
      exec_mode: 'fork',
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
        PORT: '3002'
      },
      max_memory_restart: '512M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: '/home/fufu/ARCOD-Qobuz-DL/server/logs/error.log',
      out_file: '/home/fufu/ARCOD-Qobuz-DL/server/logs/out.log',
      merge_logs: true,
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: '10s'
    }
  ]
};
