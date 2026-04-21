// PM2 process config. Run with:
//   pm2 start ecosystem.config.js --env production
//   pm2 save && pm2 startup
module.exports = {
  apps: [
    {
      name: 'nurse-assessment',
      script: 'server.js',
      instances: 1,             // bump to 'max' for clustering (requires a shared session store)
      exec_mode: 'fork',        // use 'cluster' with a redis/mongo session store
      watch: false,
      max_memory_restart: '512M',
      autorestart: true,
      kill_timeout: 10000,
      env: {
        NODE_ENV: 'development',
        PORT: 4000
      },
      env_production: {
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        PORT: 4000,
        TRUST_PROXY: '1'
      },
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      merge_logs: true,
      time: true
    }
  ]
};
