module.exports = {
  apps: [
    {
      name: 'sorinote',
      script: './server/server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'development'
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
        DATABASE_PATH: './database.sqlite',
        UPLOAD_DIR: './uploads'
      }
    }
  ]
};
